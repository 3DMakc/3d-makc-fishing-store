import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import multer from "multer";
import slugify from "slugify";
import { db, initDb, ensureAdmin, q } from "./src/db.js";
import { money, safe, parseCsv, isAuthed, requireAuth } from "./src/utils.js";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.set("view engine", "ejs");
app.set("views", "./views");

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.use(session({
  secret: process.env.SESSION_SECRET || "change_me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 14 }
}));

// Init DB
initDb();
ensureAdmin();

app.use((req, res, next) => {
  res.locals.storeName = process.env.STORE_NAME || "3D_MAKC Fishing";
  res.locals.cartCount = (req.session.cart?.items?.reduce((a, it) => a + it.qty, 0)) || 0;
  res.locals.authed = isAuthed(req);
  next();
});

function getCart(req){
  if (!req.session.cart) req.session.cart = { items: [] };
  return req.session.cart;
}

function cartTotal(cart){
  return cart.items.reduce((sum, it) => sum + it.price_uah * it.qty, 0);
}

async function sendTelegram(text){
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok:false, skipped:true };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
  });
  return await r.json();
}

/** STORE **/
app.get("/", (req, res) => {
  const categories = q.all(`SELECT * FROM categories ORDER BY name`);
  const hits = q.all(`SELECT * FROM products WHERE is_active=1 ORDER BY created_at DESC LIMIT 12`);
  res.render("store/home", { categories, hits });
});

app.get("/catalog", (req, res) => {
  const { s, category, brand, min, max, inStock, sort } = req.query;
  let where = "WHERE p.is_active=1";
  const params = {};
  if (s) { where += " AND (p.name LIKE @s OR p.sku LIKE @s)"; params.s = `%${s}%`; }
  if (category) { where += " AND c.slug=@cslug"; params.cslug = category; }
  if (brand) { where += " AND p.brand=@brand"; params.brand = brand; }
  if (min) { where += " AND p.price_uah >= @min"; params.min = Number(min); }
  if (max) { where += " AND p.price_uah <= @max"; params.max = Number(max); }
  if (inStock === "1") { where += " AND p.stock > 0"; }

  let order = "ORDER BY p.created_at DESC";
  if (sort === "price_asc") order = "ORDER BY p.price_uah ASC";
  if (sort === "price_desc") order = "ORDER BY p.price_uah DESC";
  if (sort === "name_asc") order = "ORDER BY p.name ASC";

  const products = q.all(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    ${where}
    ${order}
    LIMIT 60
  `, params);

  const categories = q.all(`SELECT * FROM categories ORDER BY name`);
  const brands = q.all(`SELECT DISTINCT brand FROM products WHERE is_active=1 AND brand IS NOT NULL AND brand<>'' ORDER BY brand`);

  res.render("store/catalog", { products, categories, brands, filters: req.query });
});

app.get("/c/:slug", (req, res) => {
  res.redirect(302, `/catalog?category=${encodeURIComponent(req.params.slug)}`);
});

app.get("/p/:slug", (req, res) => {
  const product = q.get(`
    SELECT p.*, c.name as category_name, c.slug as category_slug
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    WHERE p.slug=? AND p.is_active=1
  `, [req.params.slug]);
  if (!product) return res.status(404).render("store/404");
  const images = (product.images || "").split("|").map(s => s.trim()).filter(Boolean);
  res.render("store/product", { product, images });
});

/** CART **/
app.post("/cart/add", (req, res) => {
  const { product_id, qty } = req.body;
  const p = q.get(`SELECT id,name,price_uah,slug,stock,is_active FROM products WHERE id=?`, [Number(product_id)]);
  if (!p || p.is_active !== 1) return res.status(400).send("Product not found");
  const cart = getCart(req);
  const qtty = Math.max(1, Math.min(99, Number(qty || 1)));
  const existing = cart.items.find(i => i.product_id === p.id);
  if (existing) existing.qty = Math.min(99, existing.qty + qtty);
  else cart.items.push({ product_id: p.id, name: p.name, slug: p.slug, price_uah: p.price_uah, qty: qtty });
  res.redirect(302, "/cart");
});

app.get("/cart", (req, res) => {
  const cart = getCart(req);
  res.render("store/cart", { cart, total: cartTotal(cart) });
});

app.post("/cart/update", (req, res) => {
  const cart = getCart(req);
  const updates = req.body?.qty || {};
  for (const it of cart.items) {
    if (updates[it.product_id] !== undefined) {
      const v = Number(updates[it.product_id]);
      it.qty = Math.max(1, Math.min(99, isFinite(v) ? v : it.qty));
    }
  }
  res.redirect(302, "/cart");
});

app.post("/cart/remove", (req, res) => {
  const cart = getCart(req);
  const pid = Number(req.body.product_id);
  cart.items = cart.items.filter(i => i.product_id !== pid);
  res.redirect(302, "/cart");
});

/** CHECKOUT **/
app.get("/checkout", (req, res) => {
  const cart = getCart(req);
  if (!cart.items.length) return res.redirect(302, "/catalog");
  res.render("store/checkout", { cart, total: cartTotal(cart), errors: null, form: {} });
});

app.post("/checkout", async (req, res) => {
  const cart = getCart(req);
  if (!cart.items.length) return res.redirect(302, "/catalog");

  const form = {
    full_name: safe(req.body.full_name),
    phone: safe(req.body.phone),
    region: safe(req.body.region),
    city: safe(req.body.city),
    np_branch: safe(req.body.np_branch),
    comment: safe(req.body.comment)
  };

  const errors = [];
  if (form.full_name.length < 3) errors.push("Введите ФИО");
  if (!/^\+?380\d{9}$/.test(form.phone.replace(/\s+/g,""))) errors.push("Телефон должен быть в формате +380XXXXXXXXX");
  if (form.city.length < 2) errors.push("Укажите город");
  if (form.np_branch.length < 1) errors.push("Укажите отделение Новой Почты");

  if (errors.length) {
    return res.status(400).render("store/checkout", { cart, total: cartTotal(cart), errors, form });
  }

  const total = cartTotal(cart);

  const order = q.run(`
    INSERT INTO orders (full_name, phone, region, city, np_branch, comment, total_uah, status, created_at)
    VALUES (@full_name,@phone,@region,@city,@np_branch,@comment,@total_uah,'new',datetime('now'))
  `, { ...form, total_uah: total });

  for (const it of cart.items) {
    q.run(`
      INSERT INTO order_items (order_id, product_id, name, price_uah, qty)
      VALUES (@order_id,@product_id,@name,@price_uah,@qty)
    `, { order_id: order.lastInsertRowid, ...it });
  }

  // clear cart
  req.session.cart = { items: [] };

  // telegram
  const lines = [];
  lines.push(`<b>Новый заказ #${order.lastInsertRowid}</b>`);
  lines.push(`Имя: <b>${form.full_name}</b>`);
  lines.push(`Тел: <b>${form.phone}</b>`);
  lines.push(`Город: <b>${form.city}</b>`);
  if (form.region) lines.push(`Область: ${form.region}`);
  lines.push(`НП: <b>${form.np_branch}</b>`);
  if (form.comment) lines.push(`Комментарий: ${form.comment}`);
  lines.push(``);
  lines.push(`<b>Товары:</b>`);
  for (const it of cart.items) {
    lines.push(`• ${it.name} x${it.qty} = ${money(it.price_uah * it.qty)}`);
  }
  lines.push(``);
  lines.push(`<b>Итого: ${money(total)}</b>`);

  try { await sendTelegram(lines.join("\n")); } catch(e){ /* ignore */ }

  res.render("store/thankyou", { orderId: order.lastInsertRowid });
});

/** ADMIN **/
app.get("/admin", (req, res) => {
  if (!isAuthed(req)) return res.render("admin/login", { error: null });
  return res.redirect(302, "/admin/dashboard");
});

app.post("/admin/login", (req, res) => {
  const { user, pass } = req.body;
  const ok = requireAuth(req, user, pass);
  if (!ok) return res.status(401).render("admin/login", { error: "Неверный логин или пароль" });
  res.redirect(302, "/admin/dashboard");
});

app.post("/admin/logout", (req, res) => {
  req.session.admin = null;
  res.redirect(302, "/");
});

app.get("/admin/dashboard", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const stats = {
    products: q.get(`SELECT COUNT(*) as c FROM products`).c,
    ordersNew: q.get(`SELECT COUNT(*) as c FROM orders WHERE status='new'`).c,
    ordersAll: q.get(`SELECT COUNT(*) as c FROM orders`).c,
  };
  const recentOrders = q.all(`SELECT * FROM orders ORDER BY id DESC LIMIT 20`);
  res.render("admin/dashboard", { stats, recentOrders });
});

app.get("/admin/products", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const products = q.all(`
    SELECT p.*, c.name as category_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id
    ORDER BY p.id DESC LIMIT 200
  `);
  const categories = q.all(`SELECT * FROM categories ORDER BY name`);
  res.render("admin/products", { products, categories, error: null, ok: null });
});

app.post("/admin/products/save", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const body = req.body;
  const id = Number(body.id || 0);
  const name = safe(body.name);
  const sku = safe(body.sku);
  const price_uah = Number(body.price_uah || 0);
  const stock = Number(body.stock || 0);
  const brand = safe(body.brand);
  const description = safe(body.description);
  const images = safe(body.images).split("\n").map(s=>s.trim()).filter(Boolean).join("|");
  const is_active = body.is_active === "1" ? 1 : 0;

  let category_id = null;
  if (body.category_id && body.category_id !== "null") category_id = Number(body.category_id);

  if (name.length < 2 || !isFinite(price_uah)) return res.status(400).send("Bad data");

  const slug = slugify(name, { lower: true, strict: true });

  if (id) {
    q.run(`
      UPDATE products
      SET name=@name, slug=@slug, sku=@sku, price_uah=@price_uah, stock=@stock, brand=@brand,
          category_id=@category_id, description=@description, images=@images, is_active=@is_active
      WHERE id=@id
    `, { id, name, slug, sku, price_uah, stock, brand, category_id, description, images, is_active });
  } else {
    q.run(`
      INSERT INTO products (name, slug, sku, price_uah, stock, brand, category_id, description, images, is_active, created_at)
      VALUES (@name,@slug,@sku,@price_uah,@stock,@brand,@category_id,@description,@images,@is_active,datetime('now'))
    `, { name, slug, sku, price_uah, stock, brand, category_id, description, images, is_active });
  }

  res.redirect(302, "/admin/products");
});

app.post("/admin/products/delete", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const id = Number(req.body.id);
  q.run(`DELETE FROM products WHERE id=?`, [id]);
  res.redirect(302, "/admin/products");
});

app.post("/admin/import", upload.single("file"), (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  if (!req.file) return res.status(400).send("No file");
  const csv = req.file.buffer.toString("utf-8");
  const rows = parseCsv(csv);
  let created = 0, updated = 0, skipped = 0;

  for (const r of rows) {
    const name = safe(r.name);
    if (!name) { skipped++; continue; }
    const sku = safe(r.sku);
    const price_uah = Number(r.price_uah || 0);
    const stock = Number(r.stock || 0);
    const brand = safe(r.brand);
    const categoryName = safe(r.category);
    const description = safe(r.description);
    const images = safe(r.images).split("|").map(s=>s.trim()).filter(Boolean).join("|");
    const slug = slugify(name, { lower: true, strict: true });
    const is_active = 1;

    let category_id = null;
    if (categoryName) {
      let c = q.get(`SELECT id FROM categories WHERE name=?`, [categoryName]);
      if (!c) {
        const cslug = slugify(categoryName, { lower: true, strict: true });
        const ins = q.run(`INSERT INTO categories (name, slug) VALUES (?,?)`, [categoryName, cslug]);
        category_id = ins.lastInsertRowid;
      } else category_id = c.id;
    }

    let existing = null;
    if (sku) existing = q.get(`SELECT id FROM products WHERE sku=?`, [sku]);
    if (!existing) existing = q.get(`SELECT id FROM products WHERE slug=?`, [slug]);

    if (existing) {
      q.run(`
        UPDATE products SET name=@name, slug=@slug, sku=@sku, price_uah=@price_uah, stock=@stock, brand=@brand,
          category_id=@category_id, description=@description, images=@images, is_active=@is_active
        WHERE id=@id
      `, { id: existing.id, name, slug, sku, price_uah, stock, brand, category_id, description, images, is_active });
      updated++;
    } else {
      q.run(`
        INSERT INTO products (name, slug, sku, price_uah, stock, brand, category_id, description, images, is_active, created_at)
        VALUES (@name,@slug,@sku,@price_uah,@stock,@brand,@category_id,@description,@images,@is_active,datetime('now'))
      `, { name, slug, sku, price_uah, stock, brand, category_id, description, images, is_active });
      created++;
    }
  }

  res.redirect(302, `/admin/products?import=1&created=${created}&updated=${updated}&skipped=${skipped}`);
});

app.get("/admin/orders", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const orders = q.all(`SELECT * FROM orders ORDER BY id DESC LIMIT 200`);
  res.render("admin/orders", { orders });
});

app.get("/admin/orders/:id", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const id = Number(req.params.id);
  const order = q.get(`SELECT * FROM orders WHERE id=?`, [id]);
  if (!order) return res.status(404).send("Not found");
  const items = q.all(`SELECT * FROM order_items WHERE order_id=?`, [id]);
  res.render("admin/order_detail", { order, items });
});

app.post("/admin/orders/status", (req, res) => {
  if (!isAuthed(req)) return res.redirect(302, "/admin");
  const id = Number(req.body.id);
  const status = safe(req.body.status);
  q.run(`UPDATE orders SET status=? WHERE id=?`, [status, id]);
  res.redirect(302, `/admin/orders/${id}`);
});

/** 404 **/
app.use((req, res) => {
  res.status(404).render("store/404");
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`3D_MAKC Fishing store running on http://localhost:${port}`);
});
