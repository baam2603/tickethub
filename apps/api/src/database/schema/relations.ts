import { relations } from "drizzle-orm";
import { users } from "./users";
import { organizerProfiles } from "./organizer-profiles";
import { events } from "./events";
import { ticketTypes } from "./ticket-types";
import { seats } from "./seats";
import { orders } from "./orders";
import { orderItems } from "./order-items";
import { tickets } from "./tickets";
import { transactions } from "./transactions";
import { refunds } from "./refunds";
import { gates } from "./gates";
import { eventStaff } from "./event-staff";
import { payouts } from "./payouts";
import { venues } from "./venues";
import { venueLayouts } from "./venue-layouts";

export const usersRelations = relations(users, ({ one, many }) => ({
  organizerProfile: one(organizerProfiles, {
    fields: [users.id],
    references: [organizerProfiles.userId],
  }),
  orders: many(orders),
  tickets: many(tickets),
  eventStaffAssignments: many(eventStaff),
}));

export const organizerProfilesRelations = relations(
  organizerProfiles,
  ({ one, many }) => ({
    user: one(users, {
      fields: [organizerProfiles.userId],
      references: [users.id],
    }),
    verifiedByUser: one(users, {
      fields: [organizerProfiles.verifiedBy],
      references: [users.id],
    }),
    events: many(events),
    payouts: many(payouts),
  }),
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  organizer: one(organizerProfiles, {
    fields: [events.organizerId],
    references: [organizerProfiles.id],
  }),
  venue: one(venues, {
    fields: [events.venueId],
    references: [venues.id],
  }),
  venueLayout: one(venueLayouts, {
    fields: [events.venueLayoutId],
    references: [venueLayouts.id],
  }),
  ticketTypes: many(ticketTypes),
  seats: many(seats),
  orders: many(orders),
  tickets: many(tickets),
  gates: many(gates),
  staff: many(eventStaff),
  payouts: many(payouts),
}));

export const venuesRelations = relations(venues, ({ many }) => ({
  layouts: many(venueLayouts),
  events: many(events),
}));

export const venueLayoutsRelations = relations(
  venueLayouts,
  ({ one, many }) => ({
    venue: one(venues, {
      fields: [venueLayouts.venueId],
      references: [venues.id],
    }),
    events: many(events),
  }),
);

export const ticketTypesRelations = relations(ticketTypes, ({ one, many }) => ({
  event: one(events, {
    fields: [ticketTypes.eventId],
    references: [events.id],
  }),
  seats: many(seats),
  orderItems: many(orderItems),
  tickets: many(tickets),
}));

export const seatsRelations = relations(seats, ({ one }) => ({
  event: one(events, {
    fields: [seats.eventId],
    references: [events.id],
  }),
  ticketType: one(ticketTypes, {
    fields: [seats.ticketTypeId],
    references: [ticketTypes.id],
  }),
  holdOrder: one(orders, {
    fields: [seats.holdOrderId],
    references: [orders.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [orders.eventId],
    references: [events.id],
  }),
  items: many(orderItems),
  transactions: many(transactions),
  tickets: many(tickets),
  refunds: many(refunds),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  ticketType: one(ticketTypes, {
    fields: [orderItems.ticketTypeId],
    references: [ticketTypes.id],
  }),
  seat: one(seats, {
    fields: [orderItems.seatId],
    references: [seats.id],
  }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  order: one(orders, {
    fields: [tickets.orderId],
    references: [orders.id],
  }),
  user: one(users, {
    fields: [tickets.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [tickets.eventId],
    references: [events.id],
  }),
  ticketType: one(ticketTypes, {
    fields: [tickets.ticketTypeId],
    references: [ticketTypes.id],
  }),
  seat: one(seats, {
    fields: [tickets.seatId],
    references: [seats.id],
  }),
  gate: one(gates, {
    fields: [tickets.gateId],
    references: [gates.id],
  }),
  checkedInByUser: one(users, {
    fields: [tickets.checkedInBy],
    references: [users.id],
  }),
  refunds: many(refunds),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  order: one(orders, {
    fields: [transactions.orderId],
    references: [orders.id],
  }),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
  order: one(orders, {
    fields: [refunds.orderId],
    references: [orders.id],
  }),
  ticket: one(tickets, {
    fields: [refunds.ticketId],
    references: [tickets.id],
  }),
}));

export const gatesRelations = relations(gates, ({ one, many }) => ({
  event: one(events, {
    fields: [gates.eventId],
    references: [events.id],
  }),
  staff: many(eventStaff),
  tickets: many(tickets),
}));

export const eventStaffRelations = relations(eventStaff, ({ one }) => ({
  event: one(events, {
    fields: [eventStaff.eventId],
    references: [events.id],
  }),
  user: one(users, {
    fields: [eventStaff.userId],
    references: [users.id],
  }),
  gate: one(gates, {
    fields: [eventStaff.gateId],
    references: [gates.id],
  }),
}));

export const payoutsRelations = relations(payouts, ({ one }) => ({
  organizer: one(organizerProfiles, {
    fields: [payouts.organizerId],
    references: [organizerProfiles.id],
  }),
  event: one(events, {
    fields: [payouts.eventId],
    references: [events.id],
  }),
  approvedByUser: one(users, {
    fields: [payouts.approvedBy],
    references: [users.id],
  }),
}));
