import { relations } from "drizzle-orm/relations";
import { events, curatedEvents, curatorProfiles } from "./schema";

export const curatedEventsRelations = relations(curatedEvents, ({one}) => ({
	event: one(events, {
		fields: [curatedEvents.eventId],
		references: [events.id]
	}),
	curatorProfile: one(curatorProfiles, {
		fields: [curatedEvents.userId],
		references: [curatorProfiles.userId]
	}),
}));

export const eventsRelations = relations(events, ({many}) => ({
	curatedEvents: many(curatedEvents),
}));

export const curatorProfilesRelations = relations(curatorProfiles, ({many}) => ({
	curatedEvents: many(curatedEvents),
}));