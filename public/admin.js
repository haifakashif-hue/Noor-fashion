/* ==========================================================================
   Noor Fashion — admin panel
   Everything here talks to /api/admin/*, which the server only answers for
   a logged-in user whose account has is_admin = 1.
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const money = (n) => "Rs. " + Number(n || 0).toLocaleString("en-PK");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* fall through to the generic message */
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, kind = "") {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? ` ${kind}` : "");
  el.textContent = message;
  $("toasts").append(el);
  setTimeout(() => el.remove(), 3200);
}

function showError(form, message) {
  const box = form.querySelector("[data-error]");
  box.textContent = message;
  box.hidden = false;
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

/* ------------------------------------------------------------------ gate */

async function start() {
  try {
    const { user } = await api("/api/auth/me");
    if (user && user.isAdmin) return showPanel();
  } catch {
    /* not logged in */
  }
  $("gate").hidden = false;
}

function showPanel() {
  $("gate").hidden = true;
  $("panel").hidden = false;
  loadDashboard();
}

$("adminLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  e.target.querySelector("[data-error]").hidden = true;
  try {
    const { user } = await api("/api/auth/login", { method: "POST", body: formData(e.target) });
    if (!user.isAdmin) throw new Error("This account does not have admin access");
    e.target.reset();
    showPanel();
  } catch (err) {
    showError(e.target, err.message);
  }
});

$("adminLogout").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
};

/* ------------------------------------------------------------------ tabs */

const VIEWS = {
  dashboard: loadDashboard,
  products: loadProducts,
  orders: loadOrders,
  messages: loadMessages,
};

document.querySelector(".admin-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  const view = tab.dataset.view;

  document.querySelectorAll(".admin-tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
  document.querySelectorAll("[data-view-panel]").forEach((p) => {
    p.hidden = p.dataset.viewPanel !== view;
  });
  VIEWS[view]();
});

/* ------------------------------------------------------------- dashboard */

async function loadDashboard() {
  const grid = $("statGrid");
  grid.innerHTML = "<p>Loading…</p>";
  try {
    const { stats } = await api("/api/admin/stats");
    const cards = [
      ["Total orders", stats.orders],
      ["Pending orders", stats.pending, stats.pending > 0],
      ["Revenue", money(stats.revenue)],
      ["Active products", stats.products],
      ["Low stock", stats.lowStock, stats.lowStock > 0],
      ["Unread messages", stats.unread, stats.unread > 0],
      ["Customers", stats.customers],
    ];
    grid.innerHTML = cards
      .map(
        ([label, value, alert]) =>
          `<div class="stat${alert ? " alert" : ""}"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`
      )
      .join("");
  } catch (err) {
    grid.innerHTML = `<div class="empty-box"><strong>Could not load stats</strong>${esc(err.message)}</div>`;
  }
}

/* -------------------------------------------------------------- products */

let productCache = [];

async function loadProducts() {
  const table = $("productTable");
  table.innerHTML = "<tbody><tr><td>Loading…</td></tr></tbody>";
  try {
    const { products } = await api("/api/admin/products");
    productCache = products;

    // Feed the datalist so categories stay consistent as you add products.
    const categories = [...new Set(products.map((p) => p.category))].sort();
    $("categoryList").innerHTML = categories.map((c) => `<option value="${esc(c)}">`).join("");

    if (!products.length) {
      table.innerHTML = `<tbody><tr><td><div class="empty-box"><strong>No products yet</strong>Add your first piece to get started.</div></td></tr></tbody>`;
      return;
    }

    table.innerHTML = `
      <thead><tr>
        <th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${products
          .map(
            (p) => `
          <tr class="${p.active ? "" : "inactive"}">
            <td><span class="swatch" style="background:linear-gradient(135deg,${esc(p.tone1)},${esc(p.tone2)})"></span></td>
            <td><strong>${esc(p.name)}</strong>${p.featured ? ' <span class="badge" style="position:static">FEATURED</span>' : ""}</td>
            <td>${esc(p.category)}</td>
            <td>${money(p.price)}</td>
            <td class="${p.stock <= 3 ? "low" : ""}">${p.stock}</td>
            <td>${p.active ? "Active" : "Hidden"}</td>
            <td class="actions">
              <button class="small-btn alt" data-edit="${p.id}">Edit</button>
              ${p.active ? `<button class="small-btn" data-delete="${p.id}">Remove</button>` : ""}
            </td>
          </tr>`
          )
          .join("")}
      </tbody>`;
  } catch (err) {
    table.innerHTML = `<tbody><tr><td><div class="empty-box"><strong>Could not load products</strong>${esc(err.message)}</div></td></tr></tbody>`;
  }
}

function openProductForm(product) {
  const form = $("productForm");
  form.reset();
  form.querySelector("[data-error]").hidden = true;
  $("productFormTitle").textContent = product ? "Edit product" : "Add product";

  form.id.value = product ? product.id : "";
  if (product) {
    form.name.value = product.name;
    form.category.value = product.category;
    form.price.value = product.price;
    form.stock.value = product.stock;
    form.description.value = product.description;
    form.tone1.value = product.tone1;
    form.tone2.value = product.tone2;
    form.featured.checked = product.featured === 1;
  }

  $("productModal").classList.add("open");
  $("overlay").classList.add("show");
}

function closeModal() {
  $("productModal").classList.remove("open");
  $("overlay").classList.remove("show");
}

$("newProductBtn").onclick = () => openProductForm(null);
$("overlay").onclick = closeModal;
document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeModal();
});

$("productTable").addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    const product = productCache.find((p) => p.id === Number(edit.dataset.edit));
    return openProductForm(product);
  }

  const del = e.target.closest("[data-delete]");
  if (del) {
    const product = productCache.find((p) => p.id === Number(del.dataset.delete));
    if (!confirm(`Remove “${product.name}” from the shop?\n\nPast orders keep their history — the product is just hidden from customers.`)) return;
    try {
      await api(`/api/admin/products/${product.id}`, { method: "DELETE" });
      toast("Product removed");
      loadProducts();
    } catch (err) {
      toast(err.message, "warn");
    }
  }
});

$("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  form.querySelector("[data-error]").hidden = true;

  const data = formData(form);
  const payload = {
    name: data.name,
    category: data.category,
    price: Number(data.price),
    stock: Number(data.stock),
    description: data.description,
    tone1: data.tone1,
    tone2: data.tone2,
    featured: form.featured.checked,
  };

  try {
    if (data.id) await api(`/api/admin/products/${data.id}`, { method: "PUT", body: payload });
    else await api("/api/admin/products", { method: "POST", body: payload });
    closeModal();
    toast(data.id ? "Product updated" : "Product added");
    loadProducts();
  } catch (err) {
    showError(form, err.message);
  }
});

/* ---------------------------------------------------------------- orders */

async function loadOrders() {
  const list = $("orderList");
  list.innerHTML = "<p>Loading…</p>";
  try {
    const { orders, statuses } = await api("/api/admin/orders");
    if (!orders.length) {
      list.innerHTML = `<div class="empty-box"><strong>No orders yet</strong>Orders placed in the shop will show up here.</div>`;
      return;
    }

    list.innerHTML = orders
      .map(
        (o) => `
      <article class="admin-order">
        <header>
          <div>
            <div class="order-no">${esc(o.order_no)}</div>
            <div class="who">${esc(o.name)} • ${esc(o.phone)} • ${esc(o.email)}</div>
            <div class="who">${esc(o.address)}, ${esc(o.city)}</div>
            <div class="who">${esc(o.created_at)}${o.user_id ? " • registered customer" : " • guest"}</div>
            ${o.notes ? `<div class="who">Note: ${esc(o.notes)}</div>` : ""}
          </div>
          <select class="status-select" data-order="${o.id}">
            ${statuses.map((s) => `<option value="${esc(s)}" ${s === o.status ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </header>
        <ul>
          ${o.items.map((i) => `<li><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></li>`).join("")}
          <li><span>Delivery</span><span>${o.shipping === 0 ? "Free" : money(o.shipping)}</span></li>
        </ul>
        <div class="order-foot"><span>Total</span><span>${money(o.total)}</span></div>
      </article>`
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="empty-box"><strong>Could not load orders</strong>${esc(err.message)}</div>`;
  }
}

$("orderList").addEventListener("change", async (e) => {
  const select = e.target.closest(".status-select");
  if (!select) return;
  try {
    await api(`/api/admin/orders/${select.dataset.order}`, {
      method: "PATCH",
      body: { status: select.value },
    });
    toast(`Order marked ${select.value}`);
  } catch (err) {
    toast(err.message, "warn");
    loadOrders();
  }
});

/* -------------------------------------------------------------- messages */

async function loadMessages() {
  const list = $("messageList");
  list.innerHTML = "<p>Loading…</p>";
  try {
    const { messages } = await api("/api/admin/messages");
    if (!messages.length) {
      list.innerHTML = `<div class="empty-box"><strong>No messages</strong>Contact form messages will appear here.</div>`;
      return;
    }

    list.innerHTML = messages
      .map(
        (m) => `
      <article class="msg ${m.is_read ? "" : "unread"}">
        <header>
          <div><strong>${esc(m.name)}</strong> <span class="tiny">${esc(m.email)}</span></div>
          <div class="tiny">${esc(m.created_at)}
            ${m.is_read ? "" : ` • <button class="link-btn" data-read="${m.id}">Mark as read</button>`}
          </div>
        </header>
        <p>${esc(m.message)}</p>
      </article>`
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="empty-box"><strong>Could not load messages</strong>${esc(err.message)}</div>`;
  }
}

$("messageList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-read]");
  if (!btn) return;
  try {
    await api(`/api/admin/messages/${btn.dataset.read}`, { method: "PATCH", body: { is_read: true } });
    loadMessages();
  } catch (err) {
    toast(err.message, "warn");
  }
});

/* ----------------------------------------------------------------- start */

start();
