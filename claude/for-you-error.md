Error fetching preferences: Error: Failed query: select "user*id", "blocked_hosts", "blocked_keywords", "hidden_events", "use_default_filters", "favorited_event_ids", "filter_settings", "email_digest_frequency", "email_digest_last_sent_at", "email_digest_tags", "positive_signals", "negative_signals", "positive_centroid", "negative_centroid", "centroid_updated_at", "updated_at" from "user_preferences" where "user_preferences"."user_id" = $1 limit $2
params: f02fc65b-cd72-4ace-8fc7-b0e3f3023c64,1
at n3.queryWithCache (.next/server/chunks/lib_db_index_ts_6bbf9ad2.*.js:28:36980)
at async (.next/server/chunks/lib*db_index_ts_6bbf9ad2.*.js:28:39389)
at async b (.next/server/chunks/[root-of-the-server]**9d70e639.\_.js:1:11357)
at async c (.next/server/chunks/[root-of-the-server]**9d70e639._.js:1:15726)
at async l (.next/server/chunks/[root-of-the-server]\_\_9d70e639._.js:1:16764)
at async k (.next/server/chunks/[root-of-the-server]\__9d70e639._.js:1:17842) {
query: 'select "user*id", "blocked_hosts", "blocked_keywords", "hidden_events", "use_default_filters", "favorited_event_ids", "filter_settings", "email_digest_frequency", "email_digest_last_sent_at", "email_digest_tags", "positive_signals", "negative_signals", "positive_centroid", "negative_centroid", "centroid_updated_at", "updated_at" from "user_preferences" where "user_preferences"."user_id" = $1 limit $2',
params: [Array],
[cause]: h: column "positive_signals" does not exist
at K (.next/server/chunks/lib_db_index_ts_6bbf9ad2.*.js:4:2312)
at <unknown> (.next/server/chunks/lib*db_index_ts_6bbf9ad2.*.js:4:3352)
at Socket.eU (.next/server/chunks/lib*db_index_ts_6bbf9ad2.*.js:4:3356) {
severity_local: 'ERROR',
severity: 'ERROR',
code: '42703',
position: '214',
file: 'parse_relation.c',
line: '3716',
routine: 'errorMissingColumn'
}
}
