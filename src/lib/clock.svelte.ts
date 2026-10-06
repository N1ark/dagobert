import { dayKey } from "./calendar";

/** The time, to the minute, shared so due dates turn overdue without a timer per card. */
export const clock = $state({ now: new Date(), today: dayKey(new Date()) });

setInterval(() => {
  clock.now = new Date();
  clock.today = dayKey(clock.now);
}, 30_000);
