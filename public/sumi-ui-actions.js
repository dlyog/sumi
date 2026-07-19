(function installSumiUIActions(global) {
  "use strict";

  const registry = new Map();
  const permissions = new Map();

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function validate(name, args) {
    const entry = registry.get(name);
    if (!entry) throw new Error(`Unknown Sumi UI action: ${name}`);
    if (permissions.size && !permissions.has(name)) throw new Error(`Action '${name}' is not enabled on this screen`);
    const schema = entry.schema || {};
    const input = args && typeof args === "object" ? args : {};
    for (const required of schema.required || []) {
      if (input[required] === undefined || input[required] === null || input[required] === "") throw new Error(`Action '${name}' requires ${required}`);
    }
    for (const [key, rule] of Object.entries(schema.properties || {})) {
      if (input[key] === undefined) continue;
      if (rule.type === "string" && typeof input[key] !== "string") throw new Error(`${key} must be text`);
      if (rule.type === "integer" && (!Number.isInteger(input[key]) || input[key] < (rule.minimum ?? -Infinity))) throw new Error(`${key} must be a valid integer`);
      if (rule.enum && !rule.enum.includes(input[key])) throw new Error(`${key} is not an approved value`);
    }
    return input;
  }

  const api = {
    register(name, handler, schema = {}) {
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(name) || typeof handler !== "function") throw new Error("Sumi UI actions need a stable name and handler");
      registry.set(name, { handler, schema: clone(schema) || {} });
      return api;
    },
    allow(names = []) {
      permissions.clear();
      names.forEach((name) => permissions.add(name));
      return api;
    },
    // `has` answers whether a handler exists. Screen permission is checked by
    // execute after the caller supplies the active screen's allow-list.
    has(name) { return registry.has(name); },
    definitions() { return [...registry.entries()].map(([name, entry]) => ({ name, ...clone(entry.schema) })); },
    async execute(name, args = {}, context = {}) {
      const input = validate(name, args);
      const result = await registry.get(name).handler(input, context);
      return typeof result === "string" ? { text: result } : (result || { text: "Action completed." });
    },
    async handleActionMessage(message, transport, context = {}) {
      let result;
      try {
        result = await api.execute(message.name, message.args || {}, context);
        transport?.send?.(JSON.stringify({ type: "action_result", call_id: message.call_id, ok: true, result: result.text || "Action completed.", data: result.data || null }));
      } catch (error) {
        transport?.send?.(JSON.stringify({ type: "action_result", call_id: message.call_id, ok: false, result: String(error.message || error) }));
      }
      return result;
    },
  };

  global.SumiUIActions = api;
})(window);
