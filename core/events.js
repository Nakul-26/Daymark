// Tiny event bus so features can react to each other without importing each other.
// Events used: "task:changed" (id), "task:recurred" ({ from, to }).
import { EventEmitter } from "node:events";
export const events = new EventEmitter();
