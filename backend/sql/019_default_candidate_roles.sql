INSERT INTO candidate_roles (id, name, rank_order)
SELECT defaults.id, defaults.name, defaults.rank_order FROM (
  SELECT 'd95b0b54-35e9-432f-a1f3-e726eeaa1801' AS id, 'President' AS name, 1 AS rank_order
  UNION ALL SELECT 'd95b0b54-35e9-432f-a1f3-e726eeaa1802', 'Vice president', 2
  UNION ALL SELECT 'd95b0b54-35e9-432f-a1f3-e726eeaa1803', 'Secretary', 3
) AS defaults WHERE NOT EXISTS (SELECT 1 FROM candidate_roles);
