DROP TABLE IF EXISTS "votes";
DROP TABLE IF EXISTS "candidates";
DROP TABLE IF EXISTS "positions";
DROP TABLE IF EXISTS "students";
DROP TABLE IF EXISTS "admins";
DROP TABLE IF EXISTS "election_settings";

-- Create the students table
CREATE TABLE "students" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "student_id" text UNIQUE NOT NULL,
  "email" text UNIQUE NOT NULL,
  "department" text,
  "has_voted" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Create the admins table
CREATE TABLE "admins" (
  "id" bigserial PRIMARY KEY,
  "user_id" uuid NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "fk_auth_user" FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create the positions table
CREATE TABLE "positions" (
  "id" bigserial PRIMARY KEY,
  "position_name" text UNIQUE NOT NULL,
  "max_vote" int DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

-- Create the candidates table
CREATE TABLE "candidates" (
  "id" bigserial PRIMARY KEY,
  "name" text NOT NULL,
  "position_id" bigint NOT NULL,
  "photo" text,
  "description" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "fk_position" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE
);

-- Create the votes table
CREATE TABLE "votes" (
  "id" bigserial PRIMARY KEY,
  "student_id" uuid NOT NULL,
  "candidate_id" bigint NOT NULL,
  "position_id" bigint NOT NULL,
  "vote_time" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "fk_student" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_candidate" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE,
  CONSTRAINT "fk_position" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE,
  UNIQUE ("student_id", "position_id")
);

-- Create the election_settings table
CREATE TABLE "election_settings" (
  "id" bigserial PRIMARY KEY,
  "election_name" text NOT NULL,
  "start_time" timestamptz,
  "end_time" timestamptz,
  "status" int DEFAULT 0 NOT NULL
);

-- Enable Row Level Security (RLS) for all tables
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "votes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "election_settings" ENABLE ROW LEVEL SECURITY;

-- RLS Policies for students table
CREATE POLICY "Allow students to see their own data" ON "students"
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Allow admins to manage all student data" ON "students"
  FOR ALL USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- RLS Policies for admins table
CREATE POLICY "Allow authenticated users to check if they are admin" ON "admins"
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Deny all other access to admins table" ON "admins"
  FOR ALL USING (false);

-- RLS Policies for positions table
CREATE POLICY "Allow anyone to view positions" ON "positions"
  FOR SELECT USING (true);

CREATE POLICY "Allow admins to manage positions" ON "positions"
  FOR ALL USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- RLS Policies for candidates table
CREATE POLICY "Allow anyone to view candidates" ON "candidates"
  FOR SELECT USING (true);

CREATE POLICY "Allow admins to manage candidates" ON "candidates"
  FOR ALL USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- RLS Policies for votes table
CREATE POLICY "Allow students to insert their own votes" ON "votes"
  FOR INSERT WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Allow students to see their own votes" ON "votes"
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "Allow admins to see all votes" ON "votes"
  FOR SELECT USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- RLS Policies for election_settings table
CREATE POLICY "Allow anyone to view election settings" ON "election_settings"
  FOR SELECT USING (true);

CREATE POLICY "Allow admins to manage election settings" ON "election_settings"
  FOR ALL USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- Create a function to handle vote submission
CREATE OR REPLACE FUNCTION submit_vote(
  p_student_id uuid,
  p_candidate_id bigint,
  p_position_id bigint
)
RETURNS void AS $$
DECLARE
  v_election_status int;
  v_has_voted boolean;
BEGIN
  SELECT status INTO v_election_status FROM election_settings WHERE id = 1;
  IF v_election_status != 1 THEN
    RAISE EXCEPTION 'Election is not active.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM votes WHERE student_id = p_student_id AND position_id = p_position_id
  ) INTO v_has_voted;

  IF v_has_voted THEN
    RAISE EXCEPTION 'You have already voted for this position.';
  END IF;

  INSERT INTO votes (student_id, candidate_id, position_id)
  VALUES (p_student_id, p_candidate_id, p_position_id);

  UPDATE students SET has_voted = true WHERE id = p_student_id;
END;
$$ LANGUAGE plpgsql;

-- Insert sample data for testing
-- NOTE: Admins must be created through Supabase Auth first, then added to admins table with their user_id
-- INSERT INTO "admins" ("user_id") VALUES ('<auth_user_id>');

INSERT INTO "positions" ("position_name") VALUES ('President'), ('Vice President');

INSERT INTO "candidates" ("name", "position_id") VALUES ('Candidate A', 1), ('Candidate B', 1), ('Candidate C', 2), ('Candidate D', 2);

INSERT INTO "election_settings" ("election_name", "status") VALUES ('Student Union Election', 1);
