INSERT INTO plans (code, name, description, scheduled_job_limit, max_iterations)
VALUES
  ('explorer', 'Explorer', 'Learn with local simulation and one scheduled review.', 1, 2),
  ('scholar', 'Scholar', 'Coursework plan with recurring circuit reviews.', 10, 4),
  ('lab', 'Lab', 'Research plan with larger bounded improvement runs.', 50, 8)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  scheduled_job_limit = EXCLUDED.scheduled_job_limit,
  max_iterations = EXCLUDED.max_iterations;
