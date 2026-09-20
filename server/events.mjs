// Only the small EventEmitter surface used by the engine; works in both runtimes.
export class EventEmitter {
  constructor() { this.listeners = new Map(); }
  on(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name,new Set()); this.listeners.get(name).add(handler); return this; }
  off(name, handler) { this.listeners.get(name)?.delete(handler); return this; }
  emit(name, value) { for (const handler of [...(this.listeners.get(name) || [])]) handler(value); return this.listeners.has(name); }
}
