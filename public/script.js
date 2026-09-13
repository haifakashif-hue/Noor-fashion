/* ==========================================================================
   Noor Fashion — storefront
   Products, orders and accounts all come from the server (see lib/api.js).
   The only thing kept in the browser is the cart, so it survives a refresh.
   ========================================================================== */

/* Replace with your business WhatsApp number, including country code. */
const WHATSAPP_NUMBER = "923001234567";

const state = {
  products: [],
  cart: loadCart(),
  cartData: null,   // server-priced cart (lines, subtotal, shipping, total)
  user: null,
  filter: "all",
  query: "",
  sort: "newest",
};

/* ------------------------------------------------------------------ utils */

const $ = (id) => document.getElementById(id);
const money = (n) => "Rs. " + Number(n || 0).toLocaleString("en-PK");

/** Escape text before putting it inside innerHTML. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const titleCase = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

/** Call the JSON API. Throws an Error carrying the server's message. */
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
    /* a non-JSON response falls through to the generic message below */
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
  if (!box) return toast(message, "warn");
  box.textContent = message;
  box.hidden = false;
}

function clearError(form) {
  const box = form.querySelector("[data-error]");
  if (box) box.hidden = true;
}

/** Read a form into a plain object. */
function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/* ------------------------------------------------------------------- cart */

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("noorCart") || "[]");
    return Array.isArray(raw)
      ? raw.filter((x) => Number.isInteger(x.id) && Number.isInteger(x.qty) && x.qty > 0)
      : [];
  } catch {
    return [];
  }
}

function persistCart() {
  try {
    localStorage.setItem("noorCart", JSON.stringify(state.cart));
  } catch {
    /* private browsing mode — the cart just won't survive a refresh */
  }
}

async function syncCart() {
  persistCart();
  $("cartCount").textContent = state.cart.reduce((a, x) => a + x.qty, 0);

  if (!state.cart.length) {
    state.cartData = null;
    renderCart();
    return;
  }

  try {
    state.cartData = await api("/api/cart/validate", {
      method: "POST",
      body: { items: state.cart },
    });

    // The server may have trimmed quantities or dropped unavailable items.
    // Mirror that back into the stored cart so the two stay in step.
    const valid = new Map(state.cartData.lines.map((l) => [l.id, l.qty]));
    const before = JSON.stringify(state.cart);
    state.cart = state.cart
      .filter((x) => valid.has(x.id))
      .map((x) => ({ id: x.id, qty: valid.get(x.id) }));

    if (JSON.stringify(state.cart) !== before) {
      persistCart();
      $("cartCount").textContent = state.cart.reduce((a, x) => a + x.qty, 0);
    }
    state.cartData.issues.forEach((i) => toast(i.reason, "warn"));
  } catch (err) {
    toast(err.message, "warn");
  }
  renderCart();
}

function addToCart(id, qty = 1) {
  const product = state.products.find((p) => p.id === id);
  if (product && product.stock < 1) return toast("That piece is out of stock", "warn");

  const line = state.cart.find((x) => x.id === id);
  if (line) line.qty += qty;
  else state.cart.push({ id, qty });

  syncCart().then(openCart);
  toast(product ? `${product.name} added to cart` : "Added to cart");
}

function changeQty(id, delta) {
  const line = state.cart.find((x) => x.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) state.cart = state.cart.filter((x) => x.id !== id);
  syncCart();
}

function removeItem(id) {
  state.cart = state.cart.filter((x) => x.id !== id);
  syncCart();
}

function renderCart() {
  const box = $("cartItems");
  const data = state.cartData;

  if (!data || !data.lines.length) {
    box.innerHTML =
      '<div class="empty-state" style="padding:45px 0"><strong>Your cart is empty</strong>Add something beautiful ✦</div>';
    $("cartSubtotal").textContent = money(0);
    $("cartShipping").textContent = "—";
    $("cartTotal").textContent = money(0);
    $("shippingNote").textContent = "";
    $("checkoutBtn").disabled = true;
    $("whatsappBtn").disabled = true;
    return;
  }

  box.innerHTML = data.lines
    .map(
      (l) => `
    <div class="cart-row">
      <div class="cart-thumb" style="background:linear-gradient(135deg,${esc(l.tone1)},${esc(l.tone2)})">NOOR</div>
      <div>
        <strong>${esc(l.name)}</strong>
        <div class="price">${money(l.lineTotal)}</div>
        <div class="qty">
          <button data-act="dec" data-id="${l.id}" aria-label="Decrease quantity">−</button>
          <span>${l.qty}</span>
          <button data-act="inc" data-id="${l.id}" aria-label="Increase quantity" ${l.qty >= l.stock ? "disabled" : ""}>+</button>
          <button class="link-btn" data-act="remove" data-id="${l.id}" style="margin-left:auto">Remove</button>
        </div>
      </div>
    </div>`
    )
    .join("");

  $("cartSubtotal").textContent = money(data.subtotal);
  $("cartShipping").textContent = data.shipping === 0 ? "Free" : money(data.shipping);
  $("cartTotal").textContent = money(data.total);
  $("checkoutBtn").disabled = false;
  $("whatsappBtn").disabled = false;

  const short = data.freeShippingOver - data.subtotal;
  $("shippingNote").textContent =
    short > 0 ? `Add ${money(short)} more for free delivery.` : "You have free delivery on this order.";
}

/* --------------------------------------------------------------- catalogue */

async function loadCategories() {
  try {
    const { categories } = await api("/api/categories");
    $("filters").innerHTML =
      `<button class="filter active" data-category="all">All</button>` +
      categories
        .map(
          (c) =>
            `<button class="filter" data-category="${esc(c.slug)}">${esc(titleCase(c.slug))}s</button>`
        )
        .join("");
  } catch {
    $("filters").innerHTML = `<button class="filter active" data-category="all">All</button>`;
  }
}

function skeletons(n = 8) {
  return Array.from({ length: n }, () => `<div class="skeleton"><div class="box"></div><div class="bar"></div></div>`).join("");
}

async function loadProducts() {
  const grid = $("products");
  grid.innerHTML = skeletons();

  const params = new URLSearchParams({ sort: state.sort });
  if (state.filter !== "all") params.set("category", state.filter);
  if (state.query) params.set("q", state.query);

  try {
    const { products } = await api(`/api/products?${params}`);
    state.products = products;
    renderProducts();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><strong>Could not load the collection</strong>${esc(err.message)}</div>`;
    $("resultNote").textContent = "";
  }
}

function renderProducts() {
  const grid = $("products");
  const list = state.products;

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><strong>Nothing matches that</strong>Try another search or category.</div>`;
    $("resultNote").textContent = "";
    return;
  }

  grid.innerHTML = list
    .map((p) => {
      const soldOut = p.stock < 1;
      const badges =
        (p.featured ? `<span class="badge">FEATURED</span>` : "") +
        (soldOut ? `<span class="badge dark right">SOLD OUT</span>` : "");

      return `
      <article class="product-card${soldOut ? " sold-out" : ""}">
        <div class="product-image" style="background:linear-gradient(135deg,${esc(p.tone1)},${esc(p.tone2)})">${badges}</div>
        <div class="product-info">
          <h3>${esc(p.name)}</h3>
          <p>${esc(titleCase(p.category))}</p>
          <div class="price">${money(p.price)}</div>
          ${p.stock > 0 && p.stock <= 3 ? `<div class="stock-note">Only ${p.stock} left</div>` : ""}
          <div class="product-actions">
            <button class="small-btn" data-act="add" data-id="${p.id}" ${soldOut ? "disabled" : ""}>
              ${soldOut ? "Sold Out" : "Add to Cart"}
            </button>
            <button class="small-btn alt" data-act="view" data-id="${p.id}">View</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  const bits = [`${list.length} ${list.length === 1 ? "piece" : "pieces"}`];
  if (state.query) bits.push(`for “${state.query}”`);
  $("resultNote").textContent = bits.join(" ");
}

function viewProduct(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;

  $("modalContent").innerHTML = `
    <div class="modal-content">
      <div class="modal-img" style="background:linear-gradient(135deg,${esc(p.tone1)},${esc(p.tone2)})">NOOR</div>
      <div>
        <p class="eyebrow">${esc(p.category.toUpperCase())}</p>
        <h2>${esc(p.name)}</h2>
        <div class="price" style="font-size:20px;margin-top:12px">${money(p.price)}</div>
        <p>${esc(p.description)}</p>
        <p class="tiny">${p.stock > 0 ? `${p.stock} in stock • Cash on Delivery` : "Currently out of stock"}</p>
        <button class="primary-btn" data-act="add-close" data-id="${p.id}" ${p.stock < 1 ? "disabled" : ""}>
          ${p.stock < 1 ? "Sold Out" : "Add to Cart →"}
        </button>
      </div>
    </div>`;
  openModal("productModal");
}

/* ---------------------------------------------------------------- panels */

function showOverlay() {
  $("overlay").classList.add("show");
}

function closeEverything() {
  document.querySelectorAll(".modal.open").forEach((m) => m.classList.remove("open"));
  $("cartPanel").classList.remove("open");
  $("overlay").classList.remove("show");
  $("accountMenu").hidden = true;
  $("accountBtn").setAttribute("aria-expanded", "false");
}

function openModal(id) {
  document.querySelectorAll(".modal.open").forEach((m) => m.classList.remove("open"));
  $("cartPanel").classList.remove("open");
  $(id).classList.add("open");
  showOverlay();
  const firstField = $(id).querySelector("input:not([type=hidden])");
  if (firstField) setTimeout(() => firstField.focus(), 50);
}

function openCart() {
  document.querySelectorAll(".modal.open").forEach((m) => m.classList.remove("open"));
  $("cartPanel").classList.add("open");
  showOverlay();
}

/* ------------------------------------------------------------------ auth */

async function refreshUser() {
  try {
    const { user } = await api("/api/auth/me");
    state.user = user;
  } catch {
    state.user = null;
  }
  renderAccount();
}

function renderAccount() {
  const label = $("accountLabel");
  const menu = $("accountMenu");

  if (state.user) {
    label.textContent = state.user.name.split(" ")[0];
    menu.innerHTML =
      `<p>Signed in as ${esc(state.user.email)}</p>` +
      `<button data-act="my-orders">My orders</button>` +
      (state.user.isAdmin ? `<button data-act="admin">Admin panel</button>` : "") +
      `<button data-act="logout">Log out</button>`;
  } else {
    label.textContent = "Account";
    menu.innerHTML =
      `<button data-act="login">Log in</button>` +
      `<button data-act="signup">Create account</button>` +
      `<button data-act="track">Track an order</button>`;
  }
}

function switchAuthTab(tab) {
  document.querySelectorAll("#authModal .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tab)
  );
  $("loginForm").hidden = tab !== "login";
  $("signupForm").hidden = tab !== "signup";
}

/* -------------------------------------------------------------- checkout */

function openCheckout() {
  if (!state.cartData || !state.cartData.lines.length) return toast("Your cart is empty", "warn");

  const d = state.cartData;
  $("checkoutLines").innerHTML = d.lines
    .map((l) => `<div class="co-line"><span>${esc(l.name)} × ${l.qty}</span><span>${money(l.lineTotal)}</span></div>`)
    .join("");
  $("coSubtotal").textContent = money(d.subtotal);
  $("coShipping").textContent = d.shipping === 0 ? "Free" : money(d.shipping);
  $("coTotal").textContent = money(d.total);

  // Prefill from the logged-in account so checkout is one step shorter.
  const form = $("checkoutForm");
  if (state.user) {
    if (!form.name.value) form.name.value = state.user.name;
    if (!form.email.value) form.email.value = state.user.email;
    if (!form.phone.value && state.user.phone) form.phone.value = state.user.phone;
  }
  clearError(form);
  openModal("checkoutModal");
}

function showSuccess(order) {
  $("successContent").innerHTML = `
    <div class="success-mark">✓</div>
    <p class="eyebrow">ORDER PLACED</p>
    <h2>Thank you!</h2>
    <p>Your order <strong>${esc(order.orderNo)}</strong> has been received.
       We will call you shortly to confirm delivery.</p>
    <div class="total"><span>Order total</span><strong>${money(order.total)}</strong></div>
    <p class="tiny">Save your order number — you can use it with your phone number to track this order any time.</p>`;
  openModal("successModal");
}

/* ---------------------------------------------------------------- orders */

function statusPill(status) {
  return `<span class="status-pill ${esc(status)}">${esc(status)}</span>`;
}

function orderCard(o) {
  return `
    <article class="order-card">
      <header>
        <div>
          <div class="order-no">${esc(o.order_no)}</div>
          <div class="tiny" style="margin:0">${esc(o.created_at)} • ${esc(o.city)}</div>
        </div>
        ${statusPill(o.status)}
      </header>
      <ul>
        ${o.items.map((i) => `<li><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.price * i.qty)}</span></li>`).join("")}
        <li><span>Delivery</span><span>${o.shipping === 0 ? "Free" : money(o.shipping)}</span></li>
      </ul>
      <div class="order-foot"><span>Total</span><span>${money(o.total)}</span></div>
    </article>`;
}

function switchOrdersTab(tab) {
  document.querySelectorAll("#ordersModal .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.otab === tab)
  );
  $("ordersMine").hidden = tab !== "mine";
  $("ordersTrack").hidden = tab !== "track";
}

async function openMyOrders() {
  switchOrdersTab("mine");
  openModal("ordersModal");
  $("ordersList").innerHTML = "<p>Loading your orders…</p>";
  try {
    const { orders } = await api("/api/orders/mine");
    $("ordersList").innerHTML = orders.length
      ? orders.map(orderCard).join("")
      : `<div class="empty-state"><strong>No orders yet</strong>Once you place an order it will appear here.</div>`;
  } catch (err) {
    $("ordersList").innerHTML = `<div class="empty-state"><strong>Could not load orders</strong>${esc(err.message)}</div>`;
  }
}

function openTrack() {
  switchOrdersTab("track");
  openModal("ordersModal");
}

/* ------------------------------------------------------------- whatsapp */

function orderOnWhatsApp() {
  const d = state.cartData;
  if (!d || !d.lines.length) return toast("Your cart is empty", "warn");
  if (WHATSAPP_NUMBER === "923001234567") {
    return toast("Set your WhatsApp number in public/script.js first", "warn");
  }

  const lines = d.lines.map((l) => `• ${l.name} x${l.qty} — ${money(l.lineTotal)}`).join("\n");
  const text =
    `Assalam-o-Alaikum Noor Fashion!\n\nI want to place an order:\n${lines}\n\n` +
    `Delivery: ${d.shipping === 0 ? "Free" : money(d.shipping)}\nTotal: ${money(d.total)}\n\nName:\nAddress:\nPhone:`;

  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`, "_blank");
}

/* ------------------------------------------------------------------ wire */

// One delegated click listener handles every dynamically rendered button.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (btn) {
    const id = Number(btn.dataset.id);
    switch (btn.dataset.act) {
      case "add": return addToCart(id);
      case "view": return viewProduct(id);
      case "add-close": addToCart(id); return;
      case "inc": return changeQty(id, 1);
      case "dec": return changeQty(id, -1);
      case "remove": return removeItem(id);
      case "login": switchAuthTab("login"); return openModal("authModal");
      case "signup": switchAuthTab("signup"); return openModal("authModal");
      case "my-orders": return openMyOrders();
      case "track": return openTrack();
      case "admin": return window.open("/admin.html", "_blank");
      case "logout":
        return api("/api/auth/logout", { method: "POST" }).then(() => {
          state.user = null;
          renderAccount();
          closeEverything();
          toast("Logged out");
        });
    }
  }

  if (e.target.closest("[data-close]")) return closeEverything();

  const filter = e.target.closest(".filter");
  if (filter) {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    filter.classList.add("active");
    state.filter = filter.dataset.category;
    return loadProducts();
  }

  const authTab = e.target.closest("#authModal .tab");
  if (authTab) return switchAuthTab(authTab.dataset.tab);

  const orderTab = e.target.closest("#ordersModal .tab");
  if (orderTab) return orderTab.dataset.otab === "mine" ? openMyOrders() : openTrack();

  // Clicking anywhere outside the account menu closes it.
  if (!e.target.closest(".account-wrap")) {
    $("accountMenu").hidden = true;
    $("accountBtn").setAttribute("aria-expanded", "false");
  }
});

$("accountBtn").onclick = () => {
  const menu = $("accountMenu");
  menu.hidden = !menu.hidden;
  $("accountBtn").setAttribute("aria-expanded", String(!menu.hidden));
};

$("cartBtn").onclick = openCart;
$("closeCart").onclick = closeEverything;
$("overlay").onclick = closeEverything;
$("checkoutBtn").onclick = openCheckout;
$("whatsappBtn").onclick = orderOnWhatsApp;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeEverything();
    $("searchBox").classList.remove("show");
  }
});

$("searchBtn").onclick = () => {
  const box = $("searchBox");
  box.classList.toggle("show");
  $("searchBtn").setAttribute("aria-expanded", String(box.classList.contains("show")));
  if (box.classList.contains("show")) $("searchInput").focus();
};

let searchTimer;
$("searchInput").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 220);
});

$("sortSelect").addEventListener("change", (e) => {
  state.sort = e.target.value;
  loadProducts();
});

$("menuBtn").onclick = () => {
  const nav = $("nav");
  nav.classList.toggle("open");
  $("menuBtn").setAttribute("aria-expanded", String(nav.classList.contains("open")));
};
$("nav").addEventListener("click", () => $("nav").classList.remove("open"));

/* --------------------------------------------------------------- forms */

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError(e.target);
  try {
    const { user } = await api("/api/auth/login", { method: "POST", body: formData(e.target) });
    state.user = user;
    renderAccount();
    closeEverything();
    e.target.reset();
    toast(`Welcome back, ${user.name.split(" ")[0]}`);
  } catch (err) {
    showError(e.target, err.message);
  }
});

$("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError(e.target);
  try {
    const { user } = await api("/api/auth/signup", { method: "POST", body: formData(e.target) });
    state.user = user;
    renderAccount();
    closeEverything();
    e.target.reset();
    toast(`Welcome to Noor, ${user.name.split(" ")[0]}`);
  } catch (err) {
    showError(e.target, err.message);
  }
});

$("checkoutForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError(e.target);
  const button = e.target.querySelector("button[type=submit]");
  button.disabled = true;

  try {
    const { order } = await api("/api/orders", {
      method: "POST",
      body: { ...formData(e.target), items: state.cart },
    });
    state.cart = [];
    await syncCart();
    e.target.reset();
    showSuccess(order);
    loadProducts();  // stock levels changed
  } catch (err) {
    showError(e.target, err.message);
    syncCart();
  } finally {
    button.disabled = false;
  }
});

$("trackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const wrap = $("ordersTrack");
  wrap.querySelector("[data-error]").hidden = true;
  $("trackResult").innerHTML = "";

  const { orderNo, phone } = formData(e.target);
  try {
    const { order } = await api(`/api/orders/track?orderNo=${encodeURIComponent(orderNo)}&phone=${encodeURIComponent(phone)}`);
    $("trackResult").innerHTML = orderCard(order);
  } catch (err) {
    showError(wrap, err.message);
  }
});

$("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/messages", { method: "POST", body: formData(e.target) });
    e.target.reset();
    toast("Thank you! Your message has been received.");
  } catch (err) {
    toast(err.message, "warn");
  }
});

/* ----------------------------------------------------------------- start */

loadCategories();
loadProducts();
syncCart();
refreshUser();
