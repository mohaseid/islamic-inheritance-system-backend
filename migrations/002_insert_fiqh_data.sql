-- 002_insert_fiqh_data.sql

-- 1. Insert Core Heir Types (HeirTypes Table)

INSERT INTO HeirTypes (name_en, name_ar, classification, default_share) VALUES 
('Husband', 'زوج', 'As-hab al-Faraid', 0.5000),
('Wife', 'زوجة', 'As-hab al-Faraid', 0.2500), -- Use generic 'Wife'
('Mother', 'أم', 'As-hab al-Faraid', 0.3333),
('Father', 'أب', 'As-hab al-Faraid', 0.1667),
('Daughter', 'بنت', 'As-hab al-Faraid', 0.5000),
('Full Sister', 'أخت شقيقة', 'As-hab al-Faraid', 0.5000),
('Son', 'ابن', 'Asaba', NULL), 
('Paternal Grandfather', 'جد أب', 'Asaba', NULL),
('Full Brother', 'أخ شقيق', 'Asaba', NULL)
ON CONFLICT DO NOTHING;


-- 2. Insert Inheritance Rules (FiqhRules Table)
-- We use subqueries with LIMIT 1 to ensure only one ID is returned, 
-- preventing the "more than one row returned" error.

-- Rule 1: Wife Reduction: 1/4 (0.25) to 1/8 (0.125) due to descendant (Son)
INSERT INTO FiqhRules (heir_type_id, condition_heir_id, condition_type, reduction_factor, description_en)
SELECT 
    (SELECT heir_type_id FROM HeirTypes WHERE name_en = 'Wife' LIMIT 1),
    (SELECT heir_type_id FROM HeirTypes WHERE name_en = 'Son' LIMIT 1),
    'Reduction', 
    0.1250, 
    'Wife share reduced from 1/4 to 1/8 due to the presence of a descendant (Son).'
ON CONFLICT DO NOTHING;

-- Rule 2: Mother Reduction: 1/3 (0.3333) to 1/6 (0.1667) due to descendant (Son)
INSERT INTO FiqhRules (heir_type_id, condition_heir_id, condition_type, reduction_factor, description_en)
SELECT 
    (SELECT heir_type_id FROM HeirTypes WHERE name_en = 'Mother' LIMIT 1),
    (SELECT heir_type_id FROM HeirTypes WHERE name_en = 'Son' LIMIT 1),
    'Reduction', 
    0.1667, 
    'Mother''s share reduced from 1/3 to 1/6 due to the presence of a descendant.'
ON CONFLICT DO NOTHING;

-- Rule 3: Full Brother Exclusion: Excluded by Son
INSERT INTO FiqhRules (heir_type_id, condition_heir_id, condition_type, reduction_factor, description_en)
SELECT 
    (SELECT heir_type_id FROM HeirTypes WHERE name_en = 'Full Brother' LIMIT 1),
    (SELECT heir_type_id FROM HeirTypes WHERE name_en = 'Son' LIMIT 1),
    'Exclusion', 
    NULL,
    'Excluded by a male descendant (Son).'
ON CONFLICT DO NOTHING;