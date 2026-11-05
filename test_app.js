const assert = require('assert');
const {
  normalizeGrade,
  computeUnitStats,
  computeCourseStats,
  computeAttendanceStats,
  UtalcaParser,
  getDefaultCourses,
  findBestMatchingCourse,
  extractAttendanceData
} = require('./app.js');
const {
  normalizeRut,
  rutToSyntheticEmail,
  maskRut,
  validatePassword
} = require('./auth_utils.js');

// 0. Tests de RUT y contraseña
assert.strictEqual(normalizeRut('12.345.678'), '12345678');
assert.strictEqual(normalizeRut('12345678'), '12345678');
assert.strictEqual(normalizeRut('12 345 678'), '12345678');
assert.strictEqual(normalizeRut('123456'), '123456');
assert.strictEqual(normalizeRut('1234567'), '1234567');
assert.strictEqual(normalizeRut('12345678-9'), null); // el DV no se acepta
assert.strictEqual(normalizeRut('12345'), null);
assert.strictEqual(normalizeRut('abc123456'), null);
assert.strictEqual(normalizeRut(''), null);
assert.strictEqual(normalizeRut(null), null);

assert.strictEqual(rutToSyntheticEmail('12.345.678'), 'rut12345678@alumnos.utalca.cl');
assert.strictEqual(
  rutToSyntheticEmail('12.345.678', 'example.com'),
  'rut12345678@example.com'
);
assert.strictEqual(rutToSyntheticEmail('12345'), null);
assert.strictEqual(maskRut('12345678'), '•••••678');
assert.strictEqual(validatePassword('1234567').ok, false);
assert.strictEqual(validatePassword('12345678').ok, true);

// 1. Test normalizeGrade (incluyendo entrada rápida de iPhone sin punto decimal)
assert.strictEqual(normalizeGrade('6.5'), 6.5);
assert.strictEqual(normalizeGrade('6,5'), 6.5);
assert.strictEqual(normalizeGrade('65'), 6.5);
assert.strictEqual(normalizeGrade('395'), 3.95);
assert.strictEqual(normalizeGrade('8.5'), null);
assert.strictEqual(normalizeGrade('0.8'), null);
assert.strictEqual(normalizeGrade('6.5.4'), null);
assert.strictEqual(normalizeGrade('abc'), null);
assert.strictEqual(normalizeGrade(''), null);

// 2. Test Parser en Pantallazo 1 (Módulo I: Investigación)
const rawModulo1 = `
MODULO I DE INTEGRACION DE COMPETENCIAS PSICOLOGICAS: INVESTIGACION
Tipo	Calidad	Fecha de Prueba	Porcentaje	Prorroga	Nota
Informe de investigación	Obligatoria	11/12/2026	25
Laboratorio	Obligatoria	02/10/2026	10		6.5	0.650
Laboratorio	Obligatoria	23/10/2026	30
Presentación oral	Obligatoria	04/12/2026	35
`;

const parsed1 = UtalcaParser.parse(rawModulo1);
assert.strictEqual(parsed1.units.length, 1);
assert.strictEqual(parsed1.units[0].evals.length, 4);
assert.strictEqual(parsed1.units[0].evals[1].weight, 10);
assert.strictEqual(parsed1.units[0].evals[1].grade, 6.5); // Ignoró el 0.650 final

const stats1 = computeCourseStats(parsed1);
assert.strictEqual(stats1.globalPoints, 0.65);
assert.strictEqual(stats1.globalGradedWeight, 10);
assert.strictEqual(stats1.globalPendingWeight, 90);
// (3.95 - 0.65) / 0.90 = 3.6666... -> 3.7 en escala chilena 1 dec y 3.67 exacto
assert.strictEqual(stats1.effectiveNeeded, 3.7);
assert.strictEqual(stats1.effectiveNeededExact2Dec, 3.67);

// 3. Test Parser en Pantallazo 2 (Fundamentos de Psicoterapia I: 2 Unidades EXIGIBLE + Acum.Opcional + Asistencia)
const rawPsicoterapia = `
FUNDAMENTOS DE PSICOTERAPIA I
Area	Evaluación	Tipo	Calidad	Fecha de Prueba	Porcentaje	Prorroga	Nota
PSICOTERAPIA COGNITIVO CONDUCTUAL	EXIGIBLE	50
Evaluación 1	Prueba escrita	Obligatoria	10/12/2026	40
Evaluación 2	Informe de caso	Obligatoria	03/12/2026	30
Evaluación 3	Role playing	Obligatoria	04/12/2026	20
Evaluación 4	Simulación de situación práctica	Obligatoria	26/11/2026	10
Evaluación 5	Examen escrito	Acum.Opcional	25/11/2026	30
PSICOTERAPIA PSICOANALÍTICA	EXIGIBLE	50
Evaluación 1	Prueba escrita	Obligatoria	29/10/2026	40
Evaluación 2	Informe de caso	Obligatoria	30/10/2026	30
Evaluación 3	Role playing	Obligatoria	30/10/2026	20
Evaluación 4	Simulación de situación práctica	Obligatoria	15/10/2026	10
Evaluación 5	Examen escrito	Acum.Opcional	15/12/2026	30
Asistencia	EXIGIBLE	Requisito de aprobación
Evaluación 1	Asistencia	Obligatoria	01/01/1880	80% mínimo	%
`;

const parsed2 = UtalcaParser.parse(rawPsicoterapia);
assert.strictEqual(parsed2.units.length, 2);
assert.strictEqual(parsed2.units[0].weight, 50);
assert.strictEqual(parsed2.units[0].exigible, true);
assert.strictEqual(parsed2.units[0].evals.length, 4); // Acum.Opcional fue separada
assert.strictEqual(parsed2.units[1].weight, 50);
assert.strictEqual(parsed2.units[1].evals.length, 4);
assert.strictEqual(parsed2.acumOpcional.enabled, true);
assert.strictEqual(parsed2.acumOpcional.weight, 30);
assert.strictEqual(parsed2.attendance.enabled, true);
assert.strictEqual(parsed2.attendance.minPct, 80);

// 4. Test Regla de Unidad EXIGIBLE y Acumulativa Opcional Global (70% / 30%)
// Si en Unidad 1 tiene promedio 6.0 y Unidad 2 está sin notas, Unidad 2 sigue exigiendo 3.95 por sí sola
parsed2.units[0].evals.forEach((e) => (e.grade = 6.0));
const stats2 = computeCourseStats(parsed2);
assert.strictEqual(stats2.unitStats[0].points, 6.0);
assert.strictEqual(stats2.rawGlobalNeeded, 1.9); // Globalmente necesitaría 1.9
assert.strictEqual(stats2.effectiveNeeded, 4.0); // Unidad 2 es EXIGIBLE (4.0 a 1 dec, 3.95 exacto)
assert.strictEqual(stats2.effectiveNeededExact2Dec, 3.95);

// Si un alumno cierra presentación con 3.60 y va a la Acumulativa Opcional (30%):
// (3.95 - 3.60 * 0.70) / 0.30 = 4.7666... -> 4.8 a 1 dec, 4.77 a 2 dec
parsed2.units[0].evals.forEach((e) => (e.grade = 3.6));
parsed2.units[1].evals.forEach((e) => (e.grade = 3.6));
const statsAcum = computeCourseStats(parsed2);
assert.strictEqual(statsAcum.neededInAcum, 4.8);
assert.strictEqual(statsAcum.neededInAcumExact2Dec, 4.77);

// 5. Test Asistencia (80% mínimo y 100% límite)
const attOk = computeAttendanceStats({ enabled: true, minPct: 80, attended: 8, held: 9, totalEstimated: 30 });
assert.strictEqual(attOk.currentPct, 88.9);
assert.strictEqual(attOk.canMissConsecutiveNow, 1);
assert.strictEqual(attOk.maxAbsencesSemester, 6);
assert.strictEqual(attOk.remainingAbsencesSemester, 5);

const attLow = computeAttendanceStats({ enabled: true, minPct: 80, attended: 7, held: 10, totalEstimated: 30 });
assert.strictEqual(attLow.isAtRisk, true);
assert.strictEqual(attLow.mustAttendNext, 5); // (7+5)/(10+5) = 12/15 = 80%

const att100Fail = computeAttendanceStats({ enabled: true, minPct: 100, attended: 4, held: 5, totalEstimated: 20 });
assert.strictEqual(att100Fail.isAtRisk, true);
assert.strictEqual(att100Fail.mustAttendNext, null); // No se puede recuperar 100%

// 6. Test findBestMatchingCourse y extractAttendanceData
const defaultCourses = getDefaultCourses();
const matchPsi = findBestMatchingCourse('Constancia de Asistencia Psicoterapia Conductual', defaultCourses);
assert.strictEqual(matchPsi !== null, true);

const ocrTextSample = `
CCCTA035 - FUNDAMENTOS DE PSICOTERAPIA I
12/03/2026 Presente
19/03/2026 Presente
26/03/2026 Ausente
02/04/2026 Presente
`;
const detectedAtt = extractAttendanceData(ocrTextSample, null, defaultCourses);
assert.strictEqual(detectedAtt.length >= 1, true);
assert.strictEqual(detectedAtt[0].attended, 3);
assert.strictEqual(detectedAtt[0].held, 4);
assert.strictEqual(detectedAtt[0].pct, 75);

// 7. Test Subdivisión y Decimales (ej. 33.3% * 3)
const unit33 = {
  id: 'u-dec',
  name: 'Unidad Decimal',
  weight: 100,
  exigible: true,
  evals: [
    { id: 'e1', name: 'Ev 1', weight: 33.3, grade: 5.0 },
    { id: 'e2', name: 'Ev 2', weight: 33.3, grade: null },
    { id: 'e3', name: 'Ev 3', weight: 33.4, grade: null }
  ]
};
const u33Stats = computeUnitStats(unit33, 3.95, false);
assert.strictEqual(u33Stats.isWeightValid, true);
assert.strictEqual(u33Stats.gradedWeight, 33.3);
assert.strictEqual(u33Stats.pendingWeight, 66.7);

// 8. Ramo terminado bajo la nota mínima (sin unidad exigible reprobada)
const completeFailed = computeCourseStats({
  id: 'c-failed',
  name: 'Ramo terminado reprobado',
  passMark: 3.95,
  units: [
    {
      id: 'u-failed',
      name: 'Única',
      weight: 100,
      exigible: false,
      evals: [{ id: 'e-failed', name: 'Evaluación', weight: 100, grade: 3.0 }]
    }
  ],
  acumOpcional: { enabled: false, weight: 30, grade: null, date: '' },
  attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
});
assert.strictEqual(completeFailed.isComplete, true);
assert.strictEqual(completeFailed.effectiveFinalGrade, 3);
assert.strictEqual(completeFailed.hasFailedExigibleUnit, false);
assert.strictEqual(completeFailed.acumPending, false);

// 9. Acumulativa pendiente: no marcar reprobado antes de rendirla
const acumPending = computeCourseStats({
  id: 'c-acum',
  name: 'Ramo con acumulativa pendiente',
  passMark: 3.95,
  units: [
    {
      id: 'u-acum',
      name: 'Única',
      weight: 100,
      exigible: true,
      evals: [{ id: 'e-acum', name: 'Evaluación', weight: 100, grade: 3.5 }]
    }
  ],
  acumOpcional: { enabled: true, weight: 30, grade: null, date: '' },
  attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
});
assert.strictEqual(acumPending.isComplete, true);
assert.strictEqual(acumPending.acumPending, true);
assert.strictEqual(acumPending.neededInAcum, 5.0);

console.log('✓ Todos los tests del motor chileno, unidades exigibles, acumulativa 70/30, asistencia, matching OCR y parser Utalca pasaron con éxito.');
