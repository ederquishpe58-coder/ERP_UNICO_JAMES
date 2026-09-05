# Migraciones excluidas

## 202608160001_payroll_v2.sql

- STATUS: EXCLUDED / DO NOT APPLY
- REASON: Superseded and not part of the approved migration lineage.
- REMOTE EXPECTATION: ABSENT

Este archivo se conserva fuera de `supabase/migrations/` para impedir que los
comandos oficiales de migración lo incluyan accidentalmente. No debe marcarse
como aplicado ni ejecutarse contra Supabase TEST.

## 202608240001_operations_label_assignment_lineage.sql

- STATUS: DISCARDED / DO NOT APPLY
- REASON: Invalid physical lineage assumption between classification and bunch.
- REMOTE EXPECTATION: ABSENT

El archivo se conserva solamente como evidencia del experimento descartado. El
flujo físico de bunches y etiquetas Zebra es independiente del control
productivo de recepción y clasificación, por lo que esta migración no debe
formar parte de ningún plan de aplicación.
