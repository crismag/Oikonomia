-- People leave. Ministries close. Campuses are planted and folded.
--
-- Until now the organisation could only grow. A person who left the church
-- stayed in every picker in the product forever, and could not be removed —
-- correctly, because records refer to them: a report they wrote, a gathering
-- they led, a line in somebody's history. Deleting the person would detach all
-- of it or leave dangling ids.
--
-- So: deactivate, which is the same answer the configuration registry gives for
-- an option with records behind it, and the same answer a responsibility group
-- gives. An inactive record is **not offered** and stays **fully readable**
-- wherever it is already referenced.
--
-- ## What this is not
--
-- Not authorization, and not a soft delete. Nothing about `active` decides who
-- may read anything; the access model does not consult it. And nothing is
-- hidden — an inactive person's name still resolves everywhere their name
-- already appears, because a report signed by somebody who has left is still a
-- report somebody wrote.
--
-- What it changes is what a church is *offered*: who can be given a new
-- responsibility, put on a new team, named as somebody's reporting leader.
--
-- Defaults to 1, so every existing row is active and nothing changes today.

ALTER TABLE person ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ministry ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campus ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
