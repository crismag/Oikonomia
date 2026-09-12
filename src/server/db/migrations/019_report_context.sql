-- A report belongs to the leader who wrote it, not to the page they wrote it on.
--
-- Reporting was split by the place it happened: leadership reports here,
-- Reach-Out reports there, and anything written after a LifeGroup gathering
-- could only be an entry on that gathering — visible to whoever could open the
-- gathering, and findable only by walking back through it.
--
-- Two things were wrong with that.
--
-- **A shared workspace is not a single audience.** A leader who needs to
-- record a pastoral concern about one person after a gathering must be able
-- to, without it being readable by everyone who was in the room. Workspace
-- membership is not permission to read everything filed there.
--
-- **The place is context, not a filing cabinet.** A leader should find
-- everything they have written in one place and never have to remember which
-- module they were in at the time.
--
-- So a report keeps *where it came from* and *what kind of thing it is*, and
-- neither decides who may read it. Three separate dimensions, deliberately:
--
--   context   where it originated       (metadata; opens the source)
--   category  what kind it is           (may ask for attention)
--   audience  who may read it           (visibility + audience_ids, unchanged)

ALTER TABLE leadership_report ADD COLUMN context_type TEXT;
ALTER TABLE leadership_report ADD COLUMN context_id TEXT;

-- What kind of information this is. Defined once, in domain/categories.ts,
-- which also says which categories ask for attention. Not constrained here:
-- the vocabulary is product configuration heading for administrator control,
-- and a CHECK would put half of it in the schema and half in the product.
ALTER TABLE leadership_report ADD COLUMN category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX leadership_report_context ON leadership_report (context_type, context_id);
CREATE INDEX leadership_report_category ON leadership_report (category);
