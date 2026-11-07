// Shared order book for the demo, kept in the browser (localStorage).
// The chat writes orders here; the owner dashboard (another tab) reads and
// updates them, and both update live via the "storage" event.
// In the real build this is a database on the server.

(function () {
  const KEY = "aw33_demo_store_v1";
  const empty = () => ({ orders: [], leads: [], messages: [] });

  function load() {
    try {
      return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return empty();
    }
  }
  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    listeners.forEach((fn) => fn(data, "local"));
  }
  const listeners = new Set();
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) listeners.forEach((fn) => fn(load(), "remote"));
  });

  const nowIso = () => new Date().toISOString();

  globalThis.AW33Store = {
    load,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    nextOrderNo() {
      const nums = load().orders.map((o) => Number(String(o.id).split("-")[1]) || 0);
      return Math.max(1041, ...nums) + 1;
    },
    addOrder(order) {
      const d = load();
      d.orders.unshift({ ...order, createdAt: order.createdAt || nowIso(), history: [{ at: nowIso(), text: order.historyText || "Order placed on Instagram" }] });
      save(d);
    },
    updateOrder(id, patch, note) {
      const d = load();
      const o = d.orders.find((x) => x.id === id);
      if (!o) return null;
      Object.assign(o, patch);
      if (note) o.history.push({ at: nowIso(), text: note });
      save(d);
      return o;
    },
    addLead(lead) {
      const d = load();
      d.leads.unshift({ ...lead, id: "L" + Date.now().toString(36), status: "new", createdAt: nowIso() });
      save(d);
    },
    updateLead(id, patch) {
      const d = load();
      const l = d.leads.find((x) => x.id === id);
      if (l) Object.assign(l, patch);
      save(d);
    },
    addMessage(m) {
      const d = load();
      d.messages.unshift({ ...m, id: "M" + Date.now().toString(36), status: "open", createdAt: nowIso() });
      save(d);
    },
    updateMessage(id, patch) {
      const d = load();
      const m = d.messages.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
      save(d);
    },
    clear() {
      save(empty());
    },
  };
})();
