const STORAGE_KEYS = {
  inventory: "yardtrack_inventory",
  sales: "yardtrack_sales",
  invoices: "yardtrack_invoices",
};

const COMPANY = {
  name: "Vishnu Traders",
  tagline: "Quality cement & bricks for every build",
  logoPath: "assets/Vishnu_traders_Logo.png",
  address: "Plot 12, Highway Road, Madurai, Tamil Nadu",
  contact: "+91 98765 43210",
  email: "sales@vishnutraders.in",
};

const PRODUCTS = [
  { id: "cement", name: "Cement", unit: "bags", price: 450 },
  { id: "bricks", name: "Bricks", unit: "units", price: 6 },
];

const state = {
  inventory: loadInventory(),
  sales: loadSales(),
  invoices: loadInvoices(),
  latestInvoiceId: null,
  currentView: "inventory",
};

const dom = {};
let pdfLibraryPromise = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  populateDateFields();
  initialiseSaleForm();
  bindEvents();
  renderInventory();
  renderSales();
  renderInvoices();
  updateFooterYear();
  activateView(state.currentView);
});

function cacheDom() {
  dom.stockDisplays = {};
  document
    .querySelectorAll("[data-stock-display]")
    .forEach((el) => (dom.stockDisplays[el.dataset.stockDisplay] = el));

  dom.stockForms = document.querySelectorAll(".stock-form");
  dom.saleForm = document.getElementById("sale-form");
  dom.saleProduct = document.getElementById("product");
  dom.saleQuantity = document.getElementById("quantity");
  dom.salePrice = document.getElementById("unit-price");
  dom.saleTotal = document.getElementById("total");
  dom.salesSummary = document.getElementById("sales-summary");
  dom.salesRows = document.getElementById("sales-rows");
  dom.salesCount = document.getElementById("sales-count");
  dom.invoiceForm = document.getElementById("invoice-form");
  dom.invoicePreview = document.getElementById("invoice-preview");
  dom.invoiceList = document.getElementById("invoice-list");
  dom.printInvoice = document.getElementById("print-invoice");
  dom.downloadInvoice = document.getElementById("download-invoice");
  dom.footerYear = document.getElementById("footer-year");
  dom.navLinks = document.querySelectorAll(".nav-link");
  dom.views = document.querySelectorAll("main > section");
}

function populateDateFields() {
  const today = formatDateInput(new Date());
  const saleDateField = document.getElementById("sale-date");
  if (saleDateField) saleDateField.value = today;
}

function bindEvents() {
  dom.navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      activateView(link.dataset.target);
    });
  });

  if (dom.saleProduct && dom.saleQuantity && dom.salePrice) {
    dom.saleProduct.addEventListener("change", () => {
      initialiseSaleForm(dom.saleProduct.value);
    });
    dom.saleQuantity.addEventListener("input", updateSaleTotal);
    dom.salePrice.addEventListener("input", updateSaleTotal);
  }

  dom.stockForms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const productId = form.dataset.product;
      const quantity = Number(form.quantity.value);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        showToast("Enter a valid quantity.", "warning");
        return;
      }

      const added = adjustStock(productId, quantity);
      if (added) {
        form.reset();
      }
    });
  });

  dom.saleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(dom.saleForm);
    const saleDate = formData.get("saleDate");
    const product = formData.get("product");
    const quantity = Number(formData.get("quantity"));
    const unitPrice = Number(formData.get("unitPrice"));
    const total = Number(formData.get("total"));

    if (
      !saleDate ||
      !product ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      !Number.isFinite(total) ||
      total <= 0
    ) {
      showToast("Complete all sale fields with valid values.", "warning");
      return;
    }

    recordSale({ saleDate, product, quantity, total });
    dom.saleForm.reset();
    dom.saleForm.saleDate.value = saleDate;
    initialiseSaleForm(dom.saleProduct?.value);
  });

  dom.invoiceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createInvoiceFromForm();
  });

  dom.printInvoice.addEventListener("click", () => {
    if (!state.latestInvoiceId) {
      showToast("Generate an invoice first.", "warning");
      return;
    }
    window.print();
  });

  if (dom.downloadInvoice) {
    dom.downloadInvoice.addEventListener("click", () => {
      downloadInvoicePdf();
    });
  }
}

function activateView(targetId) {
  if (!targetId) return;
  state.currentView = targetId;

  dom.navLinks.forEach((link) => {
    const isActive = link.dataset.target === targetId;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-selected", String(isActive));
    link.setAttribute("tabindex", isActive ? "0" : "-1");
  });

  dom.views.forEach((view) => {
    view.hidden = view.id !== targetId;
    view.setAttribute("aria-hidden", String(view.id !== targetId));
  });

  const activeView = document.getElementById(targetId);
  activeView?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function adjustStock(productId, delta, { notify = true } = {}) {
  const product = state.inventory[productId];
  if (!product) return;

  if (delta < 0 && product.stock + delta < 0) {
    showToast(`Not enough ${product.name.toLowerCase()} in stock.`, "warning");
    return false;
  }

  const newStock = Math.max(product.stock + delta, 0);
  state.inventory[productId].stock = newStock;
  persistInventory();
  renderInventory();

  if (notify) {
    showToast(
      `${delta >= 0 ? "Added" : "Removed"} ${Math.abs(delta)} ${
        product.unit ?? ""
      } of ${product.name}.`,
      "success"
    );
  }

  return true;
}

function recordSale({ saleDate, product, quantity, total }) {
  if (!state.sales[saleDate]) {
    state.sales[saleDate] = [];
  }

  state.sales[saleDate].push({
    product,
    quantity,
    total,
    recordedAt: new Date().toISOString(),
  });

  const adjusted = adjustStock(product, -quantity, { notify: false });
  if (!adjusted) {
    state.sales[saleDate].pop();
    persistSales();
    return;
  }

  persistSales();
  renderSales();
  showToast("Sale recorded successfully.", "success");
}

function createInvoiceFromForm() {
  const formData = new FormData(dom.invoiceForm);
  const customerName = formData.get("customerName")?.trim();
  if (!customerName) {
    showToast("Customer name is required.", "warning");
    return;
  }

  const items = PRODUCTS.map((product) => {
    const quantity = Number(formData.get(`${product.id}Qty`) || 0);
    const unitPrice = Number(formData.get(`${product.id}Price`) || 0);
    return {
      product: product.id,
      name: product.name,
      unit: product.unit,
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    };
  }).filter((item) => item.quantity > 0);

  if (!items.length) {
    showToast("Add at least one product to the invoice.", "warning");
    return;
  }

  const transportCost = parseCurrency(formData.get("transportCost"));
  const labourPersons = parseCount(formData.get("labourPersons"));
  const labourCostPerPerson = parseCurrency(formData.get("labourCostPerPerson"));
  const labourTotal =
    labourPersons > 0 && labourCostPerPerson > 0
      ? Number((labourPersons * labourCostPerPerson).toFixed(2))
      : 0;
  const chargesTotal = Number(
    (transportCost + labourTotal).toFixed(2)
  );

  const invoice = {
    id: generateInvoiceId(),
    createdAt: new Date().toISOString(),
    customer: {
      name: customerName,
      contact: formData.get("customerContact")?.trim() || "",
      email: formData.get("customerEmail")?.trim() || "",
      address: formData.get("billingAddress")?.trim() || "",
    },
    notes: formData.get("notes")?.trim() || "",
    items,
  };

  invoice.charges = {
    transportCost,
    labour: {
      persons: labourPersons,
      costPerPerson: labourCostPerPerson,
      total: labourTotal,
    },
    total: chargesTotal,
  };

  const itemsTotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const subtotal = itemsTotal + chargesTotal;
  invoice.subtotal = Number(subtotal.toFixed(2));
  invoice.total = invoice.subtotal;

  state.invoices.unshift(invoice);
  state.latestInvoiceId = invoice.id;
  persistInvoices();
  renderInvoices();
  dom.invoiceForm.reset();
  showToast("Invoice created.", "success");
}

function renderInventory() {
  PRODUCTS.forEach((product) => {
    const display = dom.stockDisplays[product.id];
    if (display) {
      display.textContent = state.inventory[product.id]?.stock ?? 0;
    }
  });
}

function renderSales() {
  const todayKey = formatDateInput(new Date());
  const todaySales = state.sales[todayKey] ?? [];

  if (!todaySales.length) {
    dom.salesRows.innerHTML =
      '<tr><td colspan="6" class="empty">No sales recorded yet.</td></tr>';
    dom.salesCount.textContent = "0 entries";
  } else {
    dom.salesRows.innerHTML = todaySales
      .map((sale) => {
        const recordedAt = new Date(sale.recordedAt);
        const date = recordedAt.toLocaleDateString();
        const day = recordedAt.toLocaleDateString(undefined, {
          weekday: "short",
        });
        const time = new Date(sale.recordedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const productName = PRODUCTS.find((p) => p.id === sale.product)?.name;
        return `<tr>
            <td>${date}</td>
            <td>${day}</td>
            <td>${time}</td>
            <td>${productName}</td>
            <td>${sale.quantity}</td>
            <td>₹${sale.total.toFixed(2)}</td>
          </tr>`;
      })
      .join("");
    dom.salesCount.textContent = `${todaySales.length} entr${
      todaySales.length === 1 ? "y" : "ies"
    }`;
  }

  renderSalesSummary(todaySales);
}

function renderSalesSummary(sales) {
  if (!sales.length) {
    dom.salesSummary.innerHTML = `<p class="empty">No sales for today.</p>`;
    return;
  }

  const totals = sales.reduce((acc, sale) => {
    if (!acc[sale.product]) {
      acc[sale.product] = { quantity: 0, total: 0 };
    }
    acc[sale.product].quantity += sale.quantity;
    acc[sale.product].total += sale.total;
    return acc;
  }, {});

  dom.salesSummary.innerHTML = PRODUCTS.map((product) => {
    const data = totals[product.id];
    if (!data) return "";
    return `<div class="summary-card">
        <div>
          <span>${product.name}</span>
          <p>${data.quantity} ${product.unit}</p>
        </div>
        <span>₹${data.total.toFixed(2)}</span>
      </div>`;
  }).join("");
}

function initialiseSaleForm(productId = dom.saleProduct?.value || PRODUCTS[0]?.id) {
  if (!dom.saleForm) return;
  const product = findProduct(productId) || PRODUCTS[0];
  if (!product) return;

  if (dom.saleProduct) {
    dom.saleProduct.value = product.id;
  }

  if (dom.salePrice) {
    const price = Number(product.price);
    dom.salePrice.value = Number.isFinite(price) ? price.toFixed(2) : "";
  }

  updateSaleTotal();
}

function updateSaleTotal() {
  if (!dom.saleQuantity || !dom.salePrice || !dom.saleTotal) return;

  const quantity = Number(dom.saleQuantity.value);
  const price = Number(dom.salePrice.value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    dom.saleTotal.value = "";
    return;
  }

  const calculated =
    Number.isFinite(price) && price >= 0 ? quantity * price : NaN;
  dom.saleTotal.value = Number.isFinite(calculated)
    ? calculated.toFixed(2)
    : "";
}

function findProduct(productId) {
  return PRODUCTS.find((product) => product.id === productId);
}

function renderInvoices() {
  if (!state.invoices.length) {
    dom.invoicePreview.classList.add("empty");
    dom.invoicePreview.innerHTML = `<div class="invoice-placeholder">
      <img src="${COMPANY.logoPath}" alt="${COMPANY.name} logo" class="invoice-placeholder-logo" />
      <p>No invoice generated yet.</p>
    </div>`;
    dom.invoiceList.innerHTML = '<li class="empty">No invoices stored yet.</li>';
    return;
  }

  const latest = state.invoices[0];
  dom.invoicePreview.classList.remove("empty");
  dom.invoicePreview.innerHTML = createInvoiceHtml(latest);

  dom.invoiceList.innerHTML = state.invoices
    .slice(0, 10)
    .map((invoice) => {
      const date = new Date(invoice.createdAt).toLocaleDateString();
      return `<li>
          <strong>#${invoice.id}</strong>
          <span>${invoice.customer.name}</span>
          <span>${date}</span>
          <span>Total: ₹${invoice.total.toFixed(2)}</span>
        </li>`;
    })
    .join("");
}

function createInvoiceHtml(invoice) {
  const date = new Date(invoice.createdAt).toLocaleString();
  const itemsHtml = invoice.items
    .map(
      (item) => `<tr>
        <td>${item.name}</td>
        <td>${item.quantity} ${item.unit}</td>
        <td>₹${item.unitPrice.toFixed(2)}</td>
        <td>₹${item.lineTotal.toFixed(2)}</td>
      </tr>`
    )
    .join("");
  const formatCurrency = (value) => Number(value || 0).toFixed(2);
  const itemsTotal = invoice.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const transportCost = invoice.charges?.transportCost ?? 0;
  const labour = invoice.charges?.labour;
  const labourTotal = labour?.total ?? 0;
  const chargesTotal =
    invoice.charges?.total ?? Number((transportCost + labourTotal).toFixed(2));
  const extrasRows = [];

  if (transportCost > 0) {
    extrasRows.push(
      `<div class="invoice-charge-row"><span>Transport</span><strong>₹${formatCurrency(
        transportCost
      )}</strong></div>`
    );
  }

  if (labourTotal > 0) {
    extrasRows.push(
      `<div class="invoice-charge-row"><span>Labour (${labour.persons} x ₹${formatCurrency(
        labour.costPerPerson
      )})</span><strong>₹${formatCurrency(labourTotal)}</strong></div>`
    );
  }

  const totalsRows = [];

  if (chargesTotal > 0) {
    totalsRows.push(
      `<div><span>Items total</span><strong>₹${formatCurrency(itemsTotal)}</strong></div>`
    );
    if (extrasRows.length) {
      totalsRows.push(...extrasRows);
    }
    totalsRows.push(
      `<div class="invoice-charges-total"><span>Charges total</span><strong>₹${formatCurrency(
        chargesTotal
      )}</strong></div>`
    );
  }

  totalsRows.push(
    `<div class="invoice-total"><span>Total</span><strong>₹${formatCurrency(
      invoice.total
    )}</strong></div>`
  );

  return `
    <div class="invoice-branding">
      <div class="invoice-brand">
        <img src="${COMPANY.logoPath}" alt="${COMPANY.name} logo" />
        <div>
          <h3>${COMPANY.name}</h3>
          <p>${COMPANY.tagline}</p>
        </div>
      </div>
      <div class="invoice-meta">
        <h4>Invoice #${invoice.id}</h4>
        <span>${date}</span>
      </div>
    </div>
    <div class="invoice-company">
      <p>${COMPANY.address}</p>
      <p>Phone: ${COMPANY.contact}</p>
      <p>Email: ${COMPANY.email}</p>
    </div>
    <div class="invoice-customer">
      <p><strong>${invoice.customer.name}</strong></p>
      ${
        invoice.customer.contact
          ? `<p>Contact: ${invoice.customer.contact}</p>`
          : ""
      }
      ${invoice.customer.email ? `<p>Email: ${invoice.customer.email}</p>` : ""}
      ${invoice.customer.address ? `<p>${invoice.customer.address}</p>` : ""}
    </div>
    <div class="table-wrapper">
      <table class="invoice-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Unit price</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>
    <div class="invoice-totals">
      ${totalsRows.join("")}
    </div>
    ${
      invoice.notes
        ? `<div class="invoice-notes"><strong>Notes</strong><p>${invoice.notes}</p></div>`
        : ""
    }
  `;
}

async function downloadInvoicePdf() {
  if (!state.latestInvoiceId || dom.invoicePreview.classList.contains("empty")) {
    showToast("Generate an invoice first.", "warning");
    return;
  }

  try {
    await ensurePdfLibrary();
  } catch (error) {
    console.error("Failed to load PDF library", error);
    showToast("Unable to load PDF generator. Check your connection.", "warning");
    return;
  }

  if (typeof window.html2pdf === "undefined") {
    showToast("PDF generator unavailable. Please refresh and try again.", "warning");
    return;
  }

  const options = {
    margin: 0.5,
    filename: `${state.latestInvoiceId}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
  };

  const clone = dom.invoicePreview.cloneNode(true);
  clone.id = "";
  clone.classList.remove("empty");

  const wrapper = document.createElement("div");
  wrapper.className = "invoice-preview";
  wrapper.style.position = "fixed";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";
  wrapper.style.width = `${dom.invoicePreview.offsetWidth}px`;
  wrapper.appendChild(clone);

  document.body.appendChild(wrapper);

  window
    .html2pdf()
    .set(options)
    .from(wrapper)
    .save()
    .then(() => {
      showToast("Invoice downloaded.", "success");
    })
    .catch((error) => {
      console.error("Failed to generate PDF", error);
      showToast("Failed to generate PDF.", "warning");
    })
    .finally(() => {
      wrapper.remove();
    });
}

function ensurePdfLibrary() {
  if (typeof window.html2pdf !== "undefined") {
    return Promise.resolve();
  }

  if (!pdfLibraryPromise) {
    pdfLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Failed to load html2pdf.js from CDN"));
      document.head.appendChild(script);
    });
  }

  return pdfLibraryPromise;
}

function parseCurrency(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Number(num.toFixed(2));
}

function parseCount(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.floor(num);
}

function persistInventory() {
  saveToStorage(STORAGE_KEYS.inventory, state.inventory);
}

function persistSales() {
  saveToStorage(STORAGE_KEYS.sales, state.sales);
}

function persistInvoices() {
  saveToStorage(STORAGE_KEYS.invoices, state.invoices);
}

function loadInventory() {
  const stored = readFromStorage(STORAGE_KEYS.inventory);
  if (stored) return stored;
  return PRODUCTS.reduce((acc, product) => {
    acc[product.id] = { name: product.name, unit: product.unit, stock: 0 };
    return acc;
  }, {});
}

function loadSales() {
  return readFromStorage(STORAGE_KEYS.sales) || {};
}

function loadInvoices() {
  return readFromStorage(STORAGE_KEYS.invoices) || [];
}

function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Failed to write to localStorage", error);
  }
}

function readFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to read from localStorage", error);
    return null;
  }
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function generateInvoiceId() {
  const now = new Date();
  return `INV${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(now.getDate()).padStart(2, "0")}-${Math.floor(
    Math.random() * 9000 + 1000
  )}`;
}

function updateFooterYear() {
  if (dom.footerYear) {
    dom.footerYear.textContent = new Date().getFullYear();
  }
}

function showToast(message, variant = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${variant}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// Toast styling
const toastStyles = document.createElement("style");
toastStyles.innerHTML = `
  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    transform: translate(-50%, 20px);
    opacity: 0;
    padding: 0.75rem 1.25rem;
    border-radius: 999px;
    font-size: 0.95rem;
    background: rgba(17, 19, 33, 0.9);
    color: #fff;
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 9999;
    box-shadow: 0 12px 24px rgba(17, 19, 33, 0.25);
  }
  .toast.visible {
    opacity: 1;
    transform: translate(-50%, 0);
  }
  .toast-success {
    background: rgba(21, 83, 181, 0.95);
  }
  .toast-warning {
    background: rgba(201, 81, 12, 0.95);
  }
`;
document.head.appendChild(toastStyles);

