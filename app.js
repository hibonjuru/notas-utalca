/* ==========================================================================
   Notas Utalca · Estética Minimalista Intranet + Motor de % y Notas Exacto
   100% Local · Sin API Keys · Optimizado para iPhone (iOS PWA) y PC
   ========================================================================== */

const STORAGE_KEY = 'utalca_organizador_v4';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Normaliza una nota en escala chilena (1.0 a 7.0).
 * Soporta "6.5", "6,5", "65" (-> 6.5), "395" (-> 3.95).
 */
function normalizeGrade(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().replace(',', '.');
  if (!str || !/^\d+(?:\.\d+)?$/.test(str)) return null;
  let num = parseFloat(str);
  if (Number.isNaN(num)) return null;
  if (num >= 10 && num <= 70 && !str.includes('.')) {
    num = num / 10;
  } else if (num >= 100 && num <= 700 && !str.includes('.')) {
    num = num / 100;
  }
  if (num < 1.0 || num > 7.0) return null;
  return Math.round(num * 100) / 100;
}

function fmtGrade(num, decimals = 1) {
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  return Number(num).toFixed(decimals);
}

/**
 * Formatea puntos ponderados a 2 decimales SIN redondear 3.947 hacia arriba a "3.95"
 * (evita que un 3.947 se muestre como "3.95" estando reprobado).
 */
function fmtPoints(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return '0.00';
  const truncated = Math.floor((Number(num) + 1e-9) * 100) / 100;
  return truncated.toFixed(2);
}

/**
 * Calcula métricas de una Unidad / Área individual (o bloque único de 100%).
 * Soporta automáticamente tanto evaluaciones que suman 100% dentro de la unidad
 * (ej. 40+30+20+10 = 100% dentro de una unidad de 50%) como evaluaciones cuyos %
 * fueron ingresados como % directo del ramo (ej. 20+15+10+5 = 50% dentro de una unidad de 50%).
 */
function computeUnitStats(unit, passMark = 3.95, isMultiUnit = false) {
  const evals = unit.evals || [];
  const parsedUW = parseFloat(unit.weight);
  const unitWeight = Math.max(0, Number.isNaN(parsedUW) ? 100 : parsedUW);

  let rawTotalWeight = 0;
  for (const ev of evals) {
    rawTotalWeight += Math.max(0, parseFloat(ev.weight) || 0);
  }

  // Detectar si el usuario ingresó los % de la unidad sumando el peso de la unidad (ej. suman 50% en una unidad de 50%)
  const isDirectGlobalPct =
    isMultiUnit &&
    evals.length >= 2 &&
    unitWeight > 0 &&
    unitWeight < 100 &&
    Math.abs(rawTotalWeight - unitWeight) < 0.5;

  const expectedUnitSum = isDirectGlobalPct ? unitWeight : 100;
  const scaleTo100 = expectedUnitSum > 0 ? 100 / expectedUnitSum : 1;

  let gradedWeight = 0;   // En escala 0..100 de la unidad
  let ungradedWeight = 0; // En escala 0..100 de la unidad para evals pendientes
  let points = 0;         // Puntos ganados dentro de la unidad (escala 0..7.0)
  const evalComputed = [];

  for (const ev of evals) {
    const rawW = Math.max(0, parseFloat(ev.weight) || 0);
    const unitSharePct = rawW * scaleTo100; // % que representa dentro de esta unidad (0..100)
    const courseSharePct = (unitWeight / 100) * unitSharePct; // % real que vale en el ramo completo

    const isSubdivided = Array.isArray(ev.subEvals) && ev.subEvals.length > 0;

    if (isSubdivided) {
      const subCount = ev.subEvals.length;
      const subUnitSharePct = subCount > 0 ? unitSharePct / subCount : 0;
      const subCourseSharePct = subCount > 0 ? courseSharePct / subCount : 0;

      let subGradedPoints = 0;
      let subGradedSum = 0;
      let subGradedCount = 0;
      const subComputed = [];

      for (const sub of ev.subEvals) {
        const sg = normalizeGrade(sub.grade);
        let subContribUnit = null;
        let subContribCourse = null;

        if (sg !== null) {
          gradedWeight += subUnitSharePct;
          subContribUnit = sg * (subUnitSharePct / 100);
          subContribCourse = sg * (subCourseSharePct / 100);
          points += subContribUnit;
          subGradedPoints += subContribUnit;
          subGradedSum += sg;
          subGradedCount++;
        } else {
          ungradedWeight += subUnitSharePct;
        }

        subComputed.push({
          id: sub.id,
          name: sub.name,
          grade: sg,
          unitSharePct: Math.round(subUnitSharePct * 100) / 100,
          courseSharePct: Math.round(subCourseSharePct * 100) / 100,
          contribUnitPts: subContribUnit !== null ? Math.round(subContribUnit * 10000) / 10000 : null,
          contribCoursePts: subContribCourse !== null ? Math.round(subContribCourse * 10000) / 10000 : null,
          neededUniform: null
        });
      }

      const subAvg = subGradedCount > 0 ? Math.round((subGradedSum / subGradedCount) * 100) / 100 : null;
      const allSubGraded = subGradedCount === subCount && subCount > 0;

      evalComputed.push({
        id: ev.id,
        rawWeight: rawW,
        unitSharePct: Math.round(unitSharePct * 100) / 100,
        courseSharePct: Math.round(courseSharePct * 100) / 100,
        grade: allSubGraded ? subAvg : null,
        contribUnitPts: subGradedCount > 0 ? Math.round(subGradedPoints * 10000) / 10000 : null,
        contribCoursePts: null,
        isSubdivided: true,
        subCount,
        subGradedCount,
        subAvg,
        subEvalsComputed: subComputed
      });
    } else {
      const g = normalizeGrade(ev.grade);
      let contribUnitPts = null;
      let contribCoursePts = null;

      if (g !== null) {
        gradedWeight += unitSharePct;
        contribUnitPts = g * (unitSharePct / 100);
        contribCoursePts = g * (courseSharePct / 100);
        points += contribUnitPts;
      } else {
        ungradedWeight += unitSharePct;
      }

      evalComputed.push({
        id: ev.id,
        rawWeight: rawW,
        unitSharePct: Math.round(unitSharePct * 100) / 100,
        courseSharePct: Math.round(courseSharePct * 100) / 100,
        grade: g,
        contribUnitPts: contribUnitPts !== null ? Math.round(contribUnitPts * 10000) / 10000 : null,
        contribCoursePts: contribCoursePts !== null ? Math.round(contribCoursePts * 10000) / 10000 : null,
        isSubdivided: false,
        subCount: 0,
        subGradedCount: 0,
        subAvg: null,
        subEvalsComputed: []
      });
    }
  }

  const totalNormalizedWeight = rawTotalWeight * scaleTo100;
  const isWeightValid = Math.abs(totalNormalizedWeight - 100) <= 0.5;
  const pendingWeight = isWeightValid
    ? Math.max(0, Math.round(ungradedWeight * 10000) / 10000)
    : (ungradedWeight > 0.001 ? Math.round(ungradedWeight * 10000) / 10000 : Math.max(0, 100 - gradedWeight));
  // Truncamos los puntos a 2 decimales reales (ej. 3.947 -> 3.94; 3.950 -> 3.95)
  const exactPoints = Math.round(points * 10000) / 10000;
  const truncatedPoints = Math.floor((exactPoints + 1e-9) * 100) / 100;
  const currentAvg = gradedWeight > 0 ? exactPoints / (gradedWeight / 100) : null;

  // Nota necesaria redondeada SIEMPRE hacia arriba a 1 decimal (escala chilena real 1.0 a 7.0: ej. 3.769 -> 3.8)
  let neededUniform = null;
  let neededExact2Dec = null;
  if (pendingWeight > 0.001) {
    const rawNeeded = (passMark - exactPoints) / (pendingWeight / 100);
    neededExact2Dec = Math.ceil((rawNeeded - 1e-9) * 100) / 100;
    neededUniform = Math.ceil((rawNeeded - 1e-9) * 10) / 10;
  }

  // Calcular para cada evaluación pendiente cuánto necesita
  evalComputed.forEach((ec) => {
    if (ec.isSubdivided) {
      let hasPendingSub = false;
      ec.subEvalsComputed.forEach((subEc) => {
        if (subEc.grade === null && subEc.unitSharePct > 0) {
          subEc.neededUniform = neededUniform;
          subEc.neededExact2Dec = neededExact2Dec;
          hasPendingSub = true;
        } else {
          subEc.neededUniform = null;
          subEc.neededExact2Dec = null;
        }
      });
      if (hasPendingSub) {
        ec.neededUniform = neededUniform;
        ec.neededExact2Dec = neededExact2Dec;
      } else {
        ec.neededUniform = null;
        ec.neededExact2Dec = null;
      }
    } else {
      if (ec.grade === null && ec.unitSharePct > 0) {
        ec.neededUniform = neededUniform;
        ec.neededExact2Dec = neededExact2Dec;
      } else {
        ec.neededUniform = null;
        ec.neededExact2Dec = null;
      }
    }
  });

  const isComplete = pendingWeight <= 0.001 && totalNormalizedWeight >= 99.5;
  const passedUnit = isComplete
    ? exactPoints + 1e-9 >= passMark
    : neededUniform !== null && neededUniform <= 1.0;
  const failedUnit = isComplete
    ? exactPoints + 1e-9 < passMark
    : neededUniform !== null && neededUniform > 7.0;

  return {
    rawTotalWeight: Math.round(rawTotalWeight * 100) / 100,
    expectedUnitSum,
    isDirectGlobalPct,
    isWeightValid,
    totalWeight: Math.round(totalNormalizedWeight * 100) / 100,
    gradedWeight: Math.round(gradedWeight * 100) / 100,
    pendingWeight: Math.round(pendingWeight * 100) / 100,
    points: truncatedPoints,
    rawPoints: exactPoints,
    currentAvg: currentAvg !== null ? Math.round(currentAvg * 100) / 100 : null,
    neededUniform,
    neededExact2Dec,
    evalComputed,
    isComplete,
    passedUnit,
    failedUnit
  };
}

/**
 * Calcula métricas globales de un Ramo (incluyendo unidades EXIGIBLES, Acum.Opcional 70/30 y Asistencia).
 */
function computeCourseStats(course) {
  const passMark = parseFloat(course.passMark) || 3.95;
  const units = course.units || [];
  const isMultiUnit = units.length > 1;
  const unitStats = units.map((u) => computeUnitStats(u, passMark, isMultiUnit));

  let totalUnitWeight = 0;
  let globalGradedWeight = 0;
  let globalPendingWeight = 0;
  let globalPoints = 0;

  units.forEach((u, idx) => {
    const uw = Math.max(0, parseFloat(u.weight) || 0);
    const st = unitStats[idx];
    totalUnitWeight += uw;
    globalGradedWeight += (uw / 100) * st.gradedWeight;
    globalPendingWeight += (uw / 100) * st.pendingWeight;
    globalPoints += (uw / 100) * st.rawPoints;
  });

  // Truncamos los puntos globales a 2 decimales sin redondear 3.947 a 3.95
  const exactGlobalPoints = Math.round(globalPoints * 10000) / 10000;
  const truncatedGlobalPoints = Math.floor((exactGlobalPoints + 1e-9) * 100) / 100;
  const currentAvg =
    globalGradedWeight > 0 ? exactGlobalPoints / (globalGradedWeight / 100) : null;

  // Nota necesaria en escala chilena real (1 decimal hacia arriba, ej. 3.769 -> 3.8) y exacta a 2 dec
  const rawGlobalNeeded =
    globalPendingWeight > 0.001
      ? Math.ceil(((passMark - exactGlobalPoints) / (globalPendingWeight / 100) - 1e-9) * 10) / 10
      : null;
  const rawGlobalNeededExact2Dec =
    globalPendingWeight > 0.001
      ? Math.ceil(((passMark - exactGlobalPoints) / (globalPendingWeight / 100) - 1e-9) * 100) / 100
      : null;

  let maxExigibleNeeded = rawGlobalNeeded;
  let maxExigibleNeededExact2Dec = rawGlobalNeededExact2Dec;
  let exigibleWarningUnit = null;
  let hasFailedExigibleUnit = false;

  units.forEach((u, idx) => {
    if (!u.exigible) return;
    const st = unitStats[idx];
    if (st.failedUnit) {
      hasFailedExigibleUnit = true;
      exigibleWarningUnit = u.name;
    }
    if (st.neededUniform !== null) {
      if (maxExigibleNeeded === null || st.neededUniform > maxExigibleNeeded) {
        maxExigibleNeeded = st.neededUniform;
        exigibleWarningUnit = isMultiUnit ? u.name : null;
      }
    }
    if (st.neededExact2Dec !== null) {
      if (maxExigibleNeededExact2Dec === null || st.neededExact2Dec > maxExigibleNeededExact2Dec) {
        maxExigibleNeededExact2Dec = st.neededExact2Dec;
      }
    }
  });

  const isComplete = globalPendingWeight <= 0.001 && totalUnitWeight >= 99.5;

  // Examen Acumulativo Opcional Global (70% presentación + 30% acumulativa)
  const acum = course.acumOpcional || { enabled: false, weight: 30, grade: null };
  const acumWeightFrac = Math.min(0.9, Math.max(0.05, (parseFloat(acum.weight) || 30) / 100));
  const presWeightFrac = 1 - acumWeightFrac;

  const presentationBase = isComplete ? truncatedGlobalPoints : currentAvg;
  let neededInAcum = null;
  let neededInAcumExact2Dec = null;
  if (presentationBase !== null) {
    const rawAcumNeed = (passMark - presentationBase * presWeightFrac) / acumWeightFrac;
    neededInAcum = Math.ceil((rawAcumNeed - 1e-9) * 10) / 10;
    neededInAcumExact2Dec = Math.ceil((rawAcumNeed - 1e-9) * 100) / 100;
  }

  const neededInAcumWithCurrentPointsOnly =
    Math.ceil(((passMark - exactGlobalPoints * presWeightFrac) / acumWeightFrac - 1e-9) * 10) / 10;

  const acumGrade = normalizeGrade(acum.grade);
  let finalWithAcum = null;
  if (acum.enabled && acumGrade !== null && presentationBase !== null) {
    finalWithAcum =
      Math.floor(((presentationBase * presWeightFrac + acumGrade * acumWeightFrac) + 1e-9) * 100) / 100;
  }

  const effectiveFinalGrade =
    finalWithAcum !== null ? finalWithAcum : isComplete ? truncatedGlobalPoints : currentAvg;

  const attendanceStats = computeAttendanceStats(
    course.attendance || { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
  );

  return {
    passMark,
    unitStats,
    totalUnitWeight: Math.round(totalUnitWeight * 100) / 100,
    globalGradedWeight: Math.round(globalGradedWeight * 100) / 100,
    globalPendingWeight: Math.round(globalPendingWeight * 100) / 100,
    globalPoints: truncatedGlobalPoints,
    rawGlobalPoints: exactGlobalPoints,
    currentAvg: currentAvg !== null ? Math.round(currentAvg * 100) / 100 : null,
    rawGlobalNeeded,
    rawGlobalNeededExact2Dec,
    effectiveNeeded: maxExigibleNeeded,
    effectiveNeededExact2Dec: maxExigibleNeededExact2Dec,
    exigibleWarningUnit,
    hasFailedExigibleUnit,
    isComplete,
    neededInAcum,
    neededInAcumExact2Dec,
    neededInAcumWithCurrentPointsOnly,
    finalWithAcum,
    acumEnabled: Boolean(acum.enabled),
    acumPending: Boolean(acum.enabled && acumGrade === null),
    effectiveFinalGrade:
      effectiveFinalGrade !== null ? Math.floor((effectiveFinalGrade + 1e-9) * 100) / 100 : null,
    attendanceStats
  };
}

/**
 * Calcula métricas de Asistencia (porcentaje actual, cuántas faltas quedan disponibles y cuántas clases seguidas asistir).
 */
function computeAttendanceStats(att) {
  const enabled = Boolean(att && att.enabled);
  const minPct = Math.min(100, Math.max(1, parseFloat(att?.minPct) || 80));
  const attended = Math.max(0, parseInt(att?.attended, 10) || 0);
  const held = Math.max(attended, parseInt(att?.held, 10) || 0);
  const totalEstimated =
    att?.totalEstimated && parseInt(att.totalEstimated, 10) > 0
      ? Math.max(held, parseInt(att.totalEstimated, 10))
      : null;

  const currentPct = held > 0 ? Math.round((attended / held) * 1000) / 10 : 100;

  const canMissConsecutiveNow =
    held > 0 ? Math.max(0, Math.floor((attended * 100) / minPct - held + 1e-9)) : 0;

  let mustAttendNext = 0;
  if (held > 0 && currentPct < minPct) {
    if (minPct < 100) {
      mustAttendNext = Math.max(
        0,
        Math.ceil((minPct * held - attended * 100) / (100 - minPct) - 1e-9)
      );
    } else {
      mustAttendNext = null;
    }
  }

  let maxAbsencesSemester = null;
  let currentAbsences = held - attended;
  let remainingAbsencesSemester = null;
  if (totalEstimated !== null) {
    maxAbsencesSemester = Math.floor((totalEstimated * (100 - minPct)) / 100 + 1e-9);
    remainingAbsencesSemester = maxAbsencesSemester - currentAbsences;
  }

  return {
    enabled,
    minPct,
    attended,
    held,
    totalEstimated,
    currentPct,
    currentAbsences,
    canMissConsecutiveNow,
    mustAttendNext,
    maxAbsencesSemester,
    remainingAbsencesSemester,
    isAtRisk: held > 0 && currentPct < minPct
  };
}

/* ==========================================================================
   Parser Inteligente de Tablas Utalca (Copy-Paste + OCR de Pantallazos)
   Ignora fechas corruptas por OCR para no confundirlas jamás con %
   ========================================================================== */

const UtalcaParser = {
  parse(rawText) {
    const lines = String(rawText || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 1);

    let courseName = '';
    const units = [];
    let currentUnit = null;
    const acumOpcional = { enabled: false, weight: 30, grade: null, date: '' };
    const attendance = { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null };
    let inAttendanceSection = false;

    const isColumnHeader = (line) => {
      const lower = line.toLowerCase();
      return (
        (lower.includes('tipo') && lower.includes('calidad')) ||
        (lower.includes('fecha') && lower.includes('porcentaje'))
      );
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim();
      const lower = line.toLowerCase();

      if (isColumnHeader(line)) continue;

      // 1. Detectar Asistencia institucional
      const isAttReqLine =
        lower.includes('requisito de aprobaci') ||
        lower.includes('1880') ||
        /\d{2}\s*%\s*m[ií]nimo/i.test(line) ||
        (/^\s*asistencia\b/i.test(line) && !/\b\d{1,3}\s*%/.test(line));

      if (isAttReqLine) {
        attendance.enabled = true;
        inAttendanceSection = true;
        const pctMatch = line.match(/(\d{2,3})\s*%/);
        if (pctMatch) {
          const p = parseInt(pctMatch[1], 10);
          if (p >= 50 && p <= 100) attendance.minPct = p;
        }
        continue;
      }

      // 2. Detectar Unidad / Área con EXIGIBLE o NO EXIGIBLE (ej. "PSICOTERAPIA COGNITIVO CONDUCTUAL EXIGIBLE 50" o "Práctica NO EXIGIBLE 100")
      if (/\b(?:no\s+)?exigible\b/i.test(line) && !lower.includes('requisito')) {
        inAttendanceSection = false;
        const isNotExigible = /\bno\s+exigible\b/i.test(line);
        const parts = line.split(/\b(?:no\s+)?exigible\b/i);
        const unitTitle = (parts[0] || '').trim() || `Unidad ${units.length + 1}`;
        const afterText = parts[1] || '';
        const weightMatch = afterText.match(/(\d{1,3}(?:[.,]\d+)?)/);
        const unitWeight = weightMatch ? parseFloat(weightMatch[1].replace(',', '.')) : 50;

        currentUnit = {
          id: uid(),
          name: unitTitle,
          weight: unitWeight,
          exigible: !isNotExigible,
          evals: []
        };
        units.push(currentUnit);
        continue;
      }

      // 3. Detectar Acum.Opcional ("Acum.Opcional" / "Acumulativa")
      if (/acum\.?\s*opcional|acumulativ[ao]/i.test(line)) {
        acumOpcional.enabled = true;
        const { dateStr, cleanTail } = this.stripAndExtractDate(line);
        if (dateStr) acumOpcional.date = dateStr;
        const nums = this.extractNumbersAfter(cleanTail);
        if (nums.weight !== null) acumOpcional.weight = nums.weight;
        if (nums.grade !== null) acumOpcional.grade = nums.grade;
        continue;
      }

      // 4. Detectar fila de Evaluación (con "Obligatoria", o con fecha, o "Evaluación X", o texto + %)
      const hasObligatoria = /obligator[ií1l]a/i.test(line);
      const startsWithEval = /^evaluaci[oó]n\s*\d/i.test(line);
      const { dateStr, beforeDate, cleanTail } = this.stripAndExtractDate(line);
      const hasExplicitPct = /\b\d{1,3}\s*%/.test(line);

      if (hasObligatoria || dateStr || startsWithEval || hasExplicitPct) {
        if (inAttendanceSection && lower.includes('asistencia')) continue;
        inAttendanceSection = false;

        let namePart = beforeDate || line;
        let numberSource = cleanTail;

        if (hasObligatoria) {
          const idx = line.search(/obligator[ií1l]a/i);
          namePart = line.slice(0, idx).trim();
          const afterOblig = line.slice(idx).replace(/^obligator[ií1l]a/i, '').trim();
          const stripped = this.stripAndExtractDate(afterOblig);
          numberSource = stripped.cleanTail;
        } else if (!dateStr) {
          // Línea simple como "Informe 25%" o "Evaluación 1 Prueba escrita 40"
          const m = line.match(/^(.*?)\s+(\d{1,3}(?:[.,]\d+)?\s*%?.*)$/);
          if (m) {
            namePart = m[1].trim();
            numberSource = m[2].trim();
          }
        }

        const { weight, grade } = this.extractNumbersAfter(numberSource);
        if (weight === null || weight <= 0 || weight > 100) continue;

        let cleanName = namePart
          .replace(/^(evaluaci[oó]n\s*\d+)\s+(.+)$/i, '$1 · $2')
          .trim();
        if (!cleanName) cleanName = `Evaluación ${(currentUnit?.evals?.length || 0) + 1}`;

        if (!currentUnit) {
          currentUnit = {
            id: uid(),
            name: 'Evaluaciones del Ramo',
            weight: 100,
            exigible: true,
            evals: []
          };
          units.push(currentUnit);
        }

        currentUnit.evals.push({
          id: uid(),
          name: cleanName,
          date: dateStr,
          weight,
          grade
        });
        continue;
      }

      // 5. Título del ramo
      if (!courseName && units.length === 0 && line.length >= 4) {
        courseName = line;
      }
    }

    let validUnits = units.filter((u) => u.evals && u.evals.length > 0);
    if (validUnits.length === 0) {
      validUnits = [{
        id: uid(),
        name: 'Evaluaciones del Ramo',
        weight: 100,
        exigible: true,
        evals: [{ id: uid(), name: 'Evaluación 1', date: '', weight: 100, grade: null }]
      }];
    }

    return {
      id: uid(),
      name: courseName || 'Nuevo Ramo Importado',
      passMark: 3.95,
      units: validUnits,
      acumOpcional,
      attendance
    };
  },

  /**
   * Encuentra y remueve cualquier fecha (incluso si el OCR leyó "11/12/2026" como "1112/2026" o "11 12 2026")
   * para que los números de la fecha NUNCA se confundan con el porcentaje.
   */
  stripAndExtractDate(text) {
    const str = String(text || '');
    // Patrón 1: Fecha estándar DD/MM/YYYY o DD-MM-YYYY
    const stdMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|1880)/);
    if (stdMatch) {
      const full = stdMatch[0];
      const idx = str.indexOf(full);
      return {
        dateStr: `${stdMatch[1].padStart(2, '0')}/${stdMatch[2].padStart(2, '0')}/${stdMatch[3]}`,
        beforeDate: str.slice(0, idx).trim(),
        cleanTail: str.slice(idx + full.length).trim()
      };
    }

    // Patrón 2: Fecha con slash omitido por OCR (ej. "1112/2026", "02/102026", "11122026", "11 12 2026")
    const ocrMatch = str.match(/\b(0[1-9]|[12]\d|3[01])[\/\-1Il\s]?(0[1-9]|1[0-2])[\/\-1Il\s]?(202\d|1880)\b/);
    if (ocrMatch) {
      const full = ocrMatch[0];
      const idx = str.indexOf(full);
      return {
        dateStr: `${ocrMatch[1]}/${ocrMatch[2]}/${ocrMatch[3]}`,
        beforeDate: str.slice(0, idx).trim(),
        cleanTail: str.slice(idx + full.length).trim()
      };
    }

    return { dateStr: '', beforeDate: str, cleanTail: str };
  },

  /**
   * Extrae { weight, grade } después de haber limpiado la fecha.
   * Ignora la última columna de ponderación de Utalca (ej. "0.650" con 3 decimales o < 1.0).
   */
  extractNumbersAfter(str) {
    const tokens = String(str || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const rawNums = [];
    for (const tok of tokens) {
      const cleaned = tok.replace(/[^0-9.,]/g, '');
      if (!cleaned) continue;
      if (/^\d+[.,]\d{3}$/.test(cleaned)) continue; // Ignora 0.650
      const val = parseFloat(cleaned.replace(',', '.'));
      if (!Number.isNaN(val)) {
        rawNums.push({ val, raw: cleaned });
      }
    }

    if (rawNums.length === 0) return { weight: null, grade: null };

    const weight = rawNums[0].val;
    let grade = null;
    for (let i = 1; i < rawNums.length; i++) {
      const candidate = rawNums[i];
      const g = normalizeGrade(candidate.raw);
      if (g !== null) {
        grade = g;
        break;
      }
    }

    return { weight, grade };
  }
};

/* ==========================================================================
   Datos Iniciales Precargados (Los 2 ramos reales de las capturas del usuario)
   ========================================================================== */

function getDefaultCourses() {
  return [
    {
      id: 'ramo-investigacion',
      name: 'MODULO I DE INTEGRACION DE COMPETENCIAS PSICOLOGICAS: INVESTIGACION',
      passMark: 3.95,
      units: [
        {
          id: 'u-inv-1',
          name: 'Evaluaciones del Ramo',
          weight: 100,
          exigible: true,
          evals: [
            { id: 'ev-1', name: 'Informe de investigación', date: '11/12/2026', weight: 25, grade: null },
            { id: 'ev-2', name: 'Laboratorio 1', date: '02/10/2026', weight: 10, grade: 6.5 },
            { id: 'ev-3', name: 'Laboratorio 2', date: '23/10/2026', weight: 30, grade: null },
            { id: 'ev-4', name: 'Presentación oral', date: '04/12/2026', weight: 35, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: false, weight: 30, grade: null, date: '' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-psicoterapia-1',
      name: 'FUNDAMENTOS DE PSICOTERAPIA I',
      passMark: 3.95,
      units: [
        {
          id: 'u-psico-cc',
          name: 'PSICOTERAPIA COGNITIVO CONDUCTUAL',
          weight: 50,
          exigible: true,
          evals: [
            { id: 'ev-cc-1', name: 'Evaluación 1 · Prueba escrita', date: '10/12/2026', weight: 40, grade: null },
            { id: 'ev-cc-2', name: 'Evaluación 2 · Informe de caso', date: '03/12/2026', weight: 30, grade: null },
            { id: 'ev-cc-3', name: 'Evaluación 3 · Role playing', date: '04/12/2026', weight: 20, grade: null },
            { id: 'ev-cc-4', name: 'Evaluación 4 · Simulación práctica', date: '26/11/2026', weight: 10, grade: null }
          ]
        },
        {
          id: 'u-psico-pa',
          name: 'PSICOTERAPIA PSICOANALÍTICA',
          weight: 50,
          exigible: true,
          evals: [
            { id: 'ev-pa-1', name: 'Evaluación 1 · Prueba escrita', date: '29/10/2026', weight: 40, grade: null },
            { id: 'ev-pa-2', name: 'Evaluación 2 · Informe de caso', date: '30/10/2026', weight: 30, grade: null },
            { id: 'ev-pa-3', name: 'Evaluación 3 · Role playing', date: '30/10/2026', weight: 20, grade: null },
            { id: 'ev-pa-4', name: 'Evaluación 4 · Simulación práctica', date: '15/10/2026', weight: 10, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: true, weight: 30, grade: null, date: '15/12/2026' },
      attendance: { enabled: true, minPct: 80, attended: 8, held: 9, totalEstimated: 30 }
    },
    {
      id: 'ramo-intervencion-grupal',
      name: 'TECNICAS DE INTERVENCION GRUPAL',
      passMark: 3.95,
      units: [
        {
          id: 'u-tig-1',
          name: 'Evaluaciones del Ramo',
          weight: 100,
          exigible: true,
          evals: [
            { id: 'ev-tig-1', name: 'Prueba escrita 1', date: '21/09/2026', weight: 30, grade: 4.3 },
            { id: 'ev-tig-2', name: 'Prueba escrita 2', date: '16/11/2026', weight: 30, grade: null },
            { id: 'ev-tig-3', name: 'Informe de proyecto 1', date: '07/09/2026', weight: 5, grade: 4.8 },
            { id: 'ev-tig-4', name: 'Informe de proyecto 2', date: '08/10/2026', weight: 10, grade: 6.0 },
            { id: 'ev-tig-5', name: 'Informe de campo o terreno', date: '28/11/2026', weight: 20, grade: null },
            { id: 'ev-tig-6', name: 'Cuaderno de notas, de campo, bitácora', date: '03/12/2026', weight: 5, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: true, weight: 30, grade: null, date: '15/12/2026' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-cosmovisiones',
      name: '(TALCA) COSMOVISIONES INDIGENAS DESDE EL ANTROPOCENO',
      passMark: 3.95,
      units: [
        {
          id: 'u-cos-1',
          name: 'Unidad 1',
          weight: 30,
          exigible: true,
          evals: [
            { id: 'ev-cos-1', name: 'Evaluación 1 · Control, Quiz', date: '03/09/2026', weight: 100, grade: 6.1 }
          ]
        },
        {
          id: 'u-cos-2',
          name: 'Unidad 2',
          weight: 30,
          exigible: true,
          evals: [
            { id: 'ev-cos-2', name: 'Evaluación 1 · Demostración práctica in situ o por video', date: '29/10/2026', weight: 100, grade: null }
          ]
        },
        {
          id: 'u-cos-3',
          name: 'Unidad 3',
          weight: 40,
          exigible: true,
          evals: [
            { id: 'ev-cos-3', name: 'Evaluación 1 · Ensayos', date: '26/11/2026', weight: 100, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: false, weight: 30, grade: null, date: '' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-acondicionamiento',
      name: '(TALCA) ACONDICIONAMIENTO FISICO',
      passMark: 3.95,
      units: [
        {
          id: 'u-aco-1',
          name: 'Práctica',
          weight: 100,
          exigible: false,
          evals: [
            { id: 'ev-aco-1', name: 'Evaluación 1 · Demostración práctica Nº1', date: '30/09/2026', weight: 25, grade: 5.0 },
            { id: 'ev-aco-2', name: 'Evaluación 2 · Demostración práctica Nº2', date: '27/10/2026', weight: 25, grade: null },
            { id: 'ev-aco-3', name: 'Evaluación 3 · Demostración práctica Nº3', date: '18/11/2026', weight: 30, grade: null },
            { id: 'ev-aco-4', name: 'Evaluación 4 · Demostración práctica Nº4', date: '02/12/2026', weight: 20, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: false, weight: 30, grade: null, date: '' },
      attendance: { enabled: true, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-psicopatologia',
      name: 'PSICOPATOLOGIA DE ADULTOS',
      passMark: 3.95,
      units: [
        {
          id: 'u-psi-1',
          name: 'Evaluaciones del Ramo',
          weight: 100,
          exigible: true,
          evals: [
            { id: 'ev-psi-1', name: 'Prueba escrita 1', date: '29/09/2026', weight: 25, grade: 4.3 },
            { id: 'ev-psi-2', name: 'Prueba escrita 2', date: '03/11/2026', weight: 25, grade: null },
            { id: 'ev-psi-3', name: 'Prueba escrita 3', date: '01/12/2026', weight: 20, grade: null },
            { id: 'ev-psi-4', name: 'Informe de caso', date: '01/12/2026', weight: 20, grade: null },
            { id: 'ev-psi-5', name: 'Control', date: '02/12/2026', weight: 10, grade: 6.3 }
          ]
        }
      ],
      acumOpcional: { enabled: true, weight: 30, grade: null, date: '12/12/2026' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-educacional',
      name: 'PSICOLOGIA EDUCACIONAL I',
      passMark: 3.95,
      units: [
        {
          id: 'u-edu-1',
          name: 'Evaluaciones del Ramo',
          weight: 100,
          exigible: true,
          evals: [
            { id: 'ev-edu-1', name: 'Prueba escrita 1', date: '22/09/2026', weight: 30, grade: 5.4 },
            { id: 'ev-edu-2', name: 'Prueba escrita 2', date: '27/10/2026', weight: 30, grade: null },
            { id: 'ev-edu-3', name: 'Informe de taller', date: '17/11/2026', weight: 20, grade: null },
            { id: 'ev-edu-4', name: 'Informe de caso', date: '24/11/2026', weight: 20, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: true, weight: 30, grade: null, date: '15/12/2026' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-trabajo',
      name: 'PSICOLOGIA DEL TRABAJO Y LAS ORGANIZACIONES II',
      passMark: 3.95,
      units: [
        {
          id: 'u-pto-1',
          name: 'Evaluaciones del Ramo',
          weight: 100,
          exigible: true,
          evals: [
            { id: 'ev-pto-1', name: 'Prueba escrita 1', date: '15/10/2026', weight: 30, grade: 3.5 },
            { id: 'ev-pto-2', name: 'Prueba escrita 2', date: '26/11/2026', weight: 30, grade: null },
            { id: 'ev-pto-3', name: 'Informe de proyecto 1', date: '10/09/2026', weight: 10, grade: 6.1 },
            { id: 'ev-pto-4', name: 'Ayudantía', date: '22/11/2026', weight: 10, grade: null },
            { id: 'ev-pto-5', name: 'Exposición Oral', date: '02/12/2026', weight: 5, grade: null },
            { id: 'ev-pto-6', name: 'Informe de proyecto 2', date: '03/12/2026', weight: 15, grade: null }
          ]
        }
      ],
      acumOpcional: { enabled: true, weight: 30, grade: null, date: '17/12/2026' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    },
    {
      id: 'ramo-comunitaria',
      name: 'PSICOLOGIA COMUNITARIA',
      passMark: 3.95,
      units: [
        {
          id: 'u-com-1',
          name: 'Evaluaciones del Ramo',
          weight: 100,
          exigible: true,
          evals: [
            { id: 'ev-com-1', name: 'Prueba escrita', date: '25/11/2026', weight: 20, grade: null },
            { id: 'ev-com-2', name: 'Tareas de resolución de problemas', date: '11/11/2026', weight: 30, grade: null },
            {
              id: 'ev-com-3',
              name: 'Control, Quiz',
              date: '28/10/2026',
              weight: 50,
              grade: null,
              subEvals: [
                { id: 'sub-com-1', name: 'Control 1', grade: null },
                { id: 'sub-com-2', name: 'Control 2', grade: null },
                { id: 'sub-com-3', name: 'Control 3', grade: null },
                { id: 'sub-com-4', name: 'Control 4', grade: null }
              ]
            }
          ]
        }
      ],
      acumOpcional: { enabled: true, weight: 30, grade: null, date: '16/12/2026' },
      attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
    }
  ];
}

function findBestMatchingCourse(queryText, courses) {
  if (!queryText || !Array.isArray(courses) || courses.length === 0) return null;
  const lowerText = String(queryText).toLowerCase();
  let bestCourse = null;
  let bestScore = 0;
  for (const course of courses) {
    const tokens = String(course.name || '')
      .toLowerCase()
      .replace(/[():]/g, ' ')
      .split(/\s+/)
      .filter(
        (t) =>
          t.length > 3 &&
          !['talca', 'para', 'como', 'desde', 'modulo', 'integracion', 'competencias'].includes(t)
      );
    const score = tokens.filter((tok) => lowerText.includes(tok)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCourse = course;
    }
  }
  return bestScore > 0 ? bestCourse : null;
}

function extractAttendanceData(text, targetCourseId = null, courseList = null) {
  const currentCourses = courseList || (typeof state !== 'undefined' ? state.courses : []);
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const found = [];

  // --- CHECK 1: Formato Oficial Constancia Asistencia APPTUI UTALCA ---
  let utalcaCode = '';
  let utalcaTitle = '';
  let presCount = 0;
  let ausCount = 0;
  let justCount = 0;
  const classDates = [];

  const codeMatch = text.match(/\b([A-Z0-9]{4,10})\s*-\s*([^\n\r]+)/i);
  if (codeMatch) {
    utalcaCode = codeMatch[1].trim();
    utalcaTitle = codeMatch[2].trim();
  }

  for (const line of lines) {
    const rowMatches = [...line.matchAll(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})(?:(?!\d{2}[\/\-]\d{2}[\/\-]\d{4})[^\n\r])*?\b(Presente(?:\s+con\s+atraso)?|Ausente|Justificada|Atraso)\b/gi)];
    for (const m of rowMatches) {
      const dt = m[1];
      const rawStatus = m[2];
      const st = rawStatus.toLowerCase();
      if (st.includes('presente') || st.includes('justificada') || st.includes('atraso')) {
        presCount++;
      } else if (st.includes('ausente')) {
        ausCount++;
      }
      classDates.push({ date: dt, status: rawStatus });
    }
  }

  if (classDates.length === 0) {
    const globalMatches = [...text.matchAll(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})(?:(?!\d{2}[\/\-]\d{2}[\/\-]\d{4})[\s\S])*?\b(Presente(?:\s+con\s+atraso)?|Ausente|Justificada|Atraso)\b/gi)];
    for (const m of globalMatches) {
      const dt = m[1];
      const rawStatus = m[2];
      const st = rawStatus.toLowerCase();
      if (st.includes('presente') || st.includes('justificada') || st.includes('atraso')) {
        presCount++;
      } else if (st.includes('ausente')) {
        ausCount++;
      }
      classDates.push({ date: dt, status: rawStatus });
    }
  }

  if (presCount + ausCount + justCount > 0) {
    const held = presCount + ausCount + justCount;
    const attended = presCount + justCount;
    const pct = Math.round((attended / held) * 1000) / 10;

    let matchedCourse = null;
    if (targetCourseId) {
      matchedCourse = currentCourses.find((c) => c.id === targetCourseId);
    }
    if (!matchedCourse) {
      matchedCourse = findBestMatchingCourse(text, currentCourses);
    }
    if (!matchedCourse && utalcaTitle) {
      matchedCourse = findBestMatchingCourse(utalcaTitle, currentCourses);
    }
    if (!matchedCourse && currentCourses.length > 0) {
      matchedCourse = currentCourses[0];
    }

    if (matchedCourse) {
      const currentMinPct = (matchedCourse.attendance && matchedCourse.attendance.minPct) ? matchedCourse.attendance.minPct : 80;
      found.push({
        course: matchedCourse,
        courseCode: utalcaCode,
        courseTitle: utalcaTitle || matchedCourse.name,
        attended,
        held,
        pct,
        minPct: currentMinPct,
        classDates,
        isUtalcaConstancia: true
      });
      return found;
    }
  }

  // --- CHECK 2: Formatos de tabla general de asistencia ---
  function parseBlock(blockText) {
    let attended = null;
    let held = null;
    let pct = null;
    let minPct = null;

    const presMatches = blockText.match(/\bpresente[s]?\b/gi);
    const ausMatches = blockText.match(/\bausente[s]?\b/gi);
    if (presMatches || ausMatches) {
      const pCount = presMatches ? presMatches.length : 0;
      const aCount = ausMatches ? ausMatches.length : 0;
      if (pCount + aCount > 0) {
        attended = pCount;
        held = pCount + aCount;
      }
    }

    const mAtt = blockText.match(/(?:clases?\s*)?(?:asistidas?|asistencia)\s*[:=]?\s*(\d{1,3})/i);
    const mHeld = blockText.match(/(?:clases?\s*)?(?:realizadas?|dictadas?|impartidas?|totales?)\s*[:=]?\s*(\d{1,3})/i);
    if (mAtt && mHeld) {
      attended = parseInt(mAtt[1], 10);
      held = parseInt(mHeld[1], 10);
    }

    if (attended === null || held === null) {
      const slashMatches = [...blockText.matchAll(/(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})/gi)];
      for (const sm of slashMatches) {
        const a = parseInt(sm[1], 10);
        const b = parseInt(sm[2], 10);
        if (b >= 1 && b <= 70 && a <= b) {
          attended = a;
          held = b;
          break;
        }
      }
    }

    const pctMatch = blockText.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
    if (pctMatch) {
      pct = parseFloat(pctMatch[1].replace(',', '.'));
    }

    const minMatch = blockText.match(/(?:m[ií]n(?:imo)?|exigible)\s*[:=]?\s*(\d{2})\s*%/i);
    if (minMatch) {
      minPct = parseInt(minMatch[1], 10);
    }

    if ((attended === null || held === null) && pct !== null) {
      if (pct >= 0 && pct <= 100) {
        attended = Math.round(pct);
        held = 100;
      }
    }

    if (attended !== null && held !== null) {
      const calcPct = held > 0 ? Math.round((attended / held) * 1000) / 10 : 0;
      return {
        attended,
        held,
        pct: pct !== null ? pct : calcPct,
        minPct: minPct || 80
      };
    }
    return null;
  }

  if (targetCourseId) {
    const course = currentCourses.find((c) => c.id === targetCourseId);
    if (course) {
      const data = parseBlock(text);
      if (data) {
        found.push({ course, ...data });
        return found;
      }
    }
  }

  currentCourses.forEach((course) => {
    const rawTokens = course.name
      .toLowerCase()
      .replace(/[():]/g, ' ')
      .split(/\s+/)
      .filter(
        (t) =>
          t.length > 3 &&
          !['talca', 'para', 'como', 'desde', 'modulo', 'integracion', 'competencias'].includes(t)
      );

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      const matchScore = rawTokens.filter((tok) => lineLower.includes(tok)).length;
      if (matchScore >= 1) {
        const windowText = lines
          .slice(Math.max(0, i - 1), Math.min(lines.length, i + 4))
          .join(' ');
        const data = parseBlock(windowText);
        if (data && !found.some((f) => f.course.id === course.id)) {
          found.push({ course, ...data });
          break;
        }
      }
    }
  });

  if (found.length === 0) {
    const generic = parseBlock(text);
    if (generic) {
      const target = currentCourses.find((c) => c.attendance?.enabled) || currentCourses[0];
      if (target) {
        found.push({ course: target, isGeneric: true, ...generic });
      }
    }
  }

  return found;
}

/* ==========================================================================
   Controlador de Interfaz (Navegación Minimalista Estilo Intranet Utalca)
   ========================================================================== */

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  let state = {
    courses: []
  };

  let currentUser = null;
  let stateVersion = 0;
  let remoteSaveTimer = null;
  let remoteSavePromise = null;
  let remoteDirty = false;
  let bannerTimer = null;
  let currentSection = 'home';
  let selectedCourseId = null;
  let pendingImportCourse = null;
  let isDeleteModePromedios = false;
  let isDeleteModeAsistencias = false;

  let subdivideTarget = {
    courseId: null,
    unitId: null,
    evalId: null,
    count: 4,
    baseName: 'Control'
  };

  function openSubdivideModal(courseId, unitId, evalId) {
    const course = state.courses.find((c) => c.id === courseId);
    const unit = course?.units.find((u) => u.id === unitId);
    const ev = unit?.evals.find((e) => e.id === evalId);
    if (!course || !unit || !ev) return;

    const currentCount = ev.subEvals?.length || 4;
    let baseName = ev.name.replace(/,.*$/, '').trim();
    if (baseName.includes('·')) baseName = baseName.split('·')[0].trim();
    if (baseName.length > 20) baseName = 'Control';
    if (!baseName) baseName = 'Control';

    subdivideTarget = {
      courseId,
      unitId,
      evalId,
      count: currentCount,
      baseName
    };

    const modalEl = document.getElementById('subdivide-modal');
    const courseNameEl = document.getElementById('subdivide-modal-course-name');
    const evalInfoEl = document.getElementById('subdivide-modal-eval-info');
    const countInput = document.getElementById('subdivide-custom-count');
    const nameInput = document.getElementById('subdivide-base-name');

    if (courseNameEl) courseNameEl.textContent = formatDisplayCourseName(course.name);
    if (evalInfoEl) {
      evalInfoEl.innerHTML = `<span><strong>${escapeHtml(ev.name)}</strong></span> <span>Ponderación: <strong>${ev.weight}%</strong></span>`;
    }
    if (countInput) countInput.value = currentCount;
    if (nameInput) nameInput.value = baseName;

    document.querySelectorAll('.quick-num-btn').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.count, 10) === currentCount);
    });

    updateSubdividePreview(ev.weight, currentCount, baseName);

    if (modalEl) modalEl.hidden = false;
  }

  function closeSubdivideModal() {
    const modalEl = document.getElementById('subdivide-modal');
    if (modalEl) modalEl.hidden = true;
    subdivideTarget = { courseId: null, unitId: null, evalId: null, count: 4, baseName: 'Control' };
  }

  function updateSubdividePreview(weight, count, baseName) {
    const previewEl = document.getElementById('subdivide-preview-calc');
    if (!previewEl) return;
    const n = Math.max(2, Math.min(20, parseInt(count, 10) || 4));
    const eachPct = Math.round((weight / n) * 100) / 100;
    previewEl.innerHTML = `
      Se crearán <strong>${n} sub-notas</strong> (${escapeHtml(baseName)} 1 a ${escapeHtml(baseName)} ${n}).<br/>
      Cada una valdrá <strong>${eachPct}%</strong> (sumando el ${weight}% asignado).
    `;
  }

  function confirmSubdivideModal() {
    const { courseId, unitId, evalId } = subdivideTarget;
    const course = state.courses.find((c) => c.id === courseId);
    const unit = course?.units.find((u) => u.id === unitId);
    const ev = unit?.evals.find((e) => e.id === evalId);
    if (!ev) return;

    const countInput = document.getElementById('subdivide-custom-count');
    const nameInput = document.getElementById('subdivide-base-name');

    const count = Math.max(2, Math.min(20, parseInt(countInput?.value, 10) || 4));
    const baseName = nameInput?.value.trim() || 'Control';

    const existingSubs = ev.subEvals || [];
    const newSubs = [];

    for (let i = 1; i <= count; i++) {
      if (existingSubs[i - 1]) {
        newSubs.push({
          ...existingSubs[i - 1],
          name: `${baseName} ${i}`
        });
      } else {
        newSubs.push({
          id: uid(),
          name: `${baseName} ${i}`,
          grade: i === 1 && ev.grade !== null ? ev.grade : null
        });
      }
    }

    ev.subEvals = newSubs;
    ev.grade = null;
    saveState();
    closeSubdivideModal();
    renderAll();
  }

  function getUserCacheKey() {
    return currentUser ? `${STORAGE_KEY}:${currentUser.id}` : STORAGE_KEY;
  }

  function readLocalJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeLocalCache() {
    if (!currentUser) return;
    try {
      localStorage.setItem(
        getUserCacheKey(),
        JSON.stringify({
          courses: state.courses,
          __version: stateVersion,
          dirty: Boolean(remoteDirty),
          savedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      console.warn('No se pudo guardar la copia local:', error);
    }
  }

  function normalizeSubEvals(list) {
    return (Array.isArray(list) ? list : []).map((sub) => {
      const item = sub && typeof sub === 'object' ? sub : {};
      return {
        id: item.id ? String(item.id) : uid(),
        name: item.name ? String(item.name) : 'Sub-nota',
        grade: normalizeGrade(item.grade)
      };
    });
  }

  function normalizeCourseShape(raw) {
    const course = raw && typeof raw === 'object' ? raw : {};

    const units = (Array.isArray(course.units) ? course.units : []).map((rawUnit) => {
      const unit = rawUnit && typeof rawUnit === 'object' ? rawUnit : {};
      const evals = (Array.isArray(unit.evals) ? unit.evals : []).map((rawEval) => {
        const evaluation = rawEval && typeof rawEval === 'object' ? rawEval : {};
        const normalized = {
          id: evaluation.id ? String(evaluation.id) : uid(),
          name: evaluation.name ? String(evaluation.name) : 'Evaluación',
          date: evaluation.date ? String(evaluation.date) : '',
          weight: Number(evaluation.weight) || 0,
          grade: normalizeGrade(evaluation.grade)
        };
        if (Array.isArray(evaluation.subEvals) && evaluation.subEvals.length > 0) {
          normalized.subEvals = normalizeSubEvals(evaluation.subEvals);
        }
        return normalized;
      });

      return {
        id: unit.id ? String(unit.id) : uid(),
        name: unit.name ? String(unit.name) : 'Unidad',
        weight: Number(unit.weight) || 0,
        exigible: Boolean(unit.exigible),
        evals:
          evals.length > 0
            ? evals
            : [{ id: uid(), name: 'Evaluación 1', date: '', weight: 100, grade: null }]
      };
    });

    if (units.length === 0) {
      units.push({
        id: uid(),
        name: 'Evaluaciones del Ramo',
        weight: 100,
        exigible: true,
        evals: [{ id: uid(), name: 'Evaluación 1', date: '', weight: 100, grade: null }]
      });
    }

    const acum = course.acumOpcional && typeof course.acumOpcional === 'object' ? course.acumOpcional : {};
    const attendance = course.attendance && typeof course.attendance === 'object' ? course.attendance : {};

    return {
      id: course.id ? String(course.id) : uid(),
      name: course.name ? String(course.name) : 'Ramo importado',
      passMark: Number(course.passMark) || 3.95,
      units,
      acumOpcional: {
        enabled: Boolean(acum.enabled),
        weight: Number(acum.weight) || 30,
        grade: normalizeGrade(acum.grade),
        date: acum.date ? String(acum.date) : ''
      },
      attendance: {
        enabled: Boolean(attendance.enabled),
        minPct: Number(attendance.minPct) || 80,
        attended: Math.max(0, parseInt(attendance.attended, 10) || 0),
        held: Math.max(0, parseInt(attendance.held, 10) || 0),
        totalEstimated:
          attendance.totalEstimated && parseInt(attendance.totalEstimated, 10) > 0
            ? parseInt(attendance.totalEstimated, 10)
            : null
      }
    };
  }

  function normalizeCourses(list) {
    return (Array.isArray(list) ? list : []).map(normalizeCourseShape);
  }

  function showCloudBanner(message, type = 'ok', ms = 3000) {
    const element = document.getElementById('cloud-banner');
    if (!element) return;
    element.textContent = message;
    element.className = `cloud-banner ${type}`;
    element.hidden = false;
    if (bannerTimer) clearTimeout(bannerTimer);
    if (ms > 0) {
      bannerTimer = setTimeout(() => {
        element.hidden = true;
      }, ms);
    }
  }

  async function loadState() {
    const defaults = getDefaultCourses();
    const cacheKey = getUserCacheKey();
    const cached = readLocalJSON(cacheKey);

    let remote = null;
    try {
      remote = await window.NotasCloud.loadState(currentUser.id);
    } catch (error) {
      console.warn('No se pudo cargar el estado remoto:', error);
      showCloudBanner('Sin conexión con la nube. Usando la copia local.', 'warn', 0);
    }

    const remoteCourses =
      remote && remote.state && Array.isArray(remote.state.courses) ? remote.state.courses : null;
    const cachedDirty = Boolean(
      cached && cached.dirty === true && Array.isArray(cached.courses) && cached.courses.length > 0
    );

    if (remoteCourses && remoteCourses.length > 0 && !cachedDirty) {
      state = { courses: normalizeCourses(remoteCourses) };
      stateVersion = Number(remote.version) || 0;
      writeLocalCache();
      return;
    }

    if (cached && Array.isArray(cached.courses) && cached.courses.length > 0) {
      state = { courses: normalizeCourses(cached.courses) };
      stateVersion = cachedDirty
        ? Number(cached.__version) || Number(remote?.version) || 0
        : Number(remote?.version) || Number(cached.__version) || 0;
      remoteDirty = cachedDirty;
      writeLocalCache();
      scheduleRemoteSave(true);
      return;
    }

    const legacy = readLocalJSON(STORAGE_KEY);
    if (legacy && Array.isArray(legacy.courses) && legacy.courses.length > 0) {
      const shouldImport = window.confirm(
        'Encontramos ramos guardados en este navegador. ¿Quieres importarlos a tu cuenta?'
      );
      if (shouldImport) {
        state = { courses: normalizeCourses(legacy.courses) };
        stateVersion = Number(remote?.version) || 0;
        saveState();
        showCloudBanner('Datos locales importados a tu cuenta.', 'ok', 4000);
        return;
      }
    }

    if (remote) {
      state = { courses: [] };
      stateVersion = Number(remote.version) || 0;
      writeLocalCache();
      return;
    }

    // Una cuenta nueva no hereda los ramos personales de la versión anterior.
    state = { courses: window.NotasCloud.getMode() === 'demo' ? defaults : [] };
    stateVersion = 0;
    saveState();
  }

  function scheduleRemoteSave(immediate = false) {
    if (!currentUser || !window.NotasCloud) return;
    remoteDirty = true;
    if (remoteSaveTimer) clearTimeout(remoteSaveTimer);

    const run = () => {
      remoteSaveTimer = null;
      if (remoteSavePromise) return;
      remoteDirty = false;

      remoteSavePromise = window.NotasCloud.saveState(currentUser.id, state, stateVersion)
        .then((result) => {
          if (result && result.conflict) {
            showCloudBanner(
              'Hay cambios guardados en otro dispositivo. Recarga para revisar la versión más reciente.',
              'warn',
              0
            );
            return;
          }
          if (result && typeof result.version === 'number') {
            stateVersion = result.version;
            writeLocalCache();
          }
          showCloudBanner(
            window.NotasCloud.getMode() === 'demo' ? 'Guardado en este dispositivo.' : 'Guardado en la nube.',
            'ok',
            1600
          );
        })
        .catch((error) => {
          console.warn('No se pudo guardar en la nube:', error);
          showCloudBanner(
            'No se pudo guardar en la nube. Tus cambios quedaron en este dispositivo.',
            'warn',
            0
          );
        })
        .finally(() => {
          remoteSavePromise = null;
          if (remoteDirty) scheduleRemoteSave();
        });
    };

    if (immediate) run();
    else remoteSaveTimer = setTimeout(run, 900);
  }

  function saveState(immediate = false) {
    if (currentUser) {
      remoteDirty = true;
      writeLocalCache();
    }
    scheduleRemoteSave(immediate);
  }

  async function handleImportJson(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawCourses = Array.isArray(parsed?.courses)
        ? parsed.courses
        : Array.isArray(parsed)
        ? parsed
        : null;

      if (!rawCourses || rawCourses.length === 0) {
        window.alert('El archivo no contiene ramos válidos.');
        return;
      }

      const courses = normalizeCourses(rawCourses);
      if (
        !window.confirm(
          `Se reemplazarán tus ${state.courses.length} ramos actuales por ${courses.length} ramos del respaldo. ¿Continuar?`
        )
      ) {
        return;
      }

      state = { courses };
      saveState();
      renderAll();
      showCloudBanner('Respaldo importado.', 'ok', 2500);
    } catch (error) {
      console.warn('Error importando respaldo:', error);
      window.alert('No se pudo leer el respaldo JSON. Verifica el archivo.');
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function neededBadgeClass(needed, passMark = 3.95) {
    if (needed === null || needed === undefined) return 'badge-neutral';
    if (needed <= passMark) return 'badge-ok';
    if (needed <= 5.4) return 'badge-warn';
    return 'badge-danger';
  }

  function neededText(needed) {
    if (needed === null || needed === undefined) return 'Completado';
    if (needed <= 1.0) return 'Aprobado (≤ 1.0)';
    if (needed > 7.0) return `Necesitas ${fmtGrade(needed, 1)} (Acum.)`;
    return `Necesitas ${fmtGrade(needed, 1)}`;
  }

  function navigateTo(section, courseId = null) {
    currentSection = section;
    selectedCourseId = courseId;
    isDeleteModePromedios = false;
    isDeleteModeAsistencias = false;
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderSidebarAndNav() {
    const allStats = state.courses.map((c) => computeCourseStats(c));
    const gradedCourses = allStats.filter((s) => s.effectiveFinalGrade !== null);
    const semAvg =
      gradedCourses.length > 0
        ? gradedCourses.reduce((acc, s) => acc + s.effectiveFinalGrade, 0) / gradedCourses.length
        : null;

    let riskCount = 0;
    allStats.forEach((s) => {
      const needRisk = s.effectiveNeeded !== null && s.effectiveNeeded > 5.5;
      const attRisk = s.attendanceStats.enabled && s.attendanceStats.isAtRisk;
      const failedCourse =
        s.isComplete &&
        s.effectiveFinalGrade !== null &&
        s.effectiveFinalGrade < s.passMark &&
        !s.acumPending;
      if (needRisk || attRisk || s.hasFailedExigibleUnit || failedCourse) riskCount++;
    });

    const elAvg = document.getElementById('summary-avg');
    const elCount = document.getElementById('summary-count');
    const elRisk = document.getElementById('summary-risk');

    if (elAvg) {
      elAvg.textContent = semAvg !== null ? fmtGrade(semAvg) : '—';
      elAvg.style.color =
        semAvg === null ? 'var(--text-soft)' : semAvg >= 3.95 ? 'var(--ok)' : 'var(--danger)';
    }
    if (elCount) elCount.textContent = String(state.courses.length);
    if (elRisk) {
      elRisk.textContent = riskCount === 0 ? 'Al día' : `${riskCount} en alerta`;
      elRisk.style.color = riskCount === 0 ? 'var(--ok)' : 'var(--danger)';
    }

    const elMobileSub = document.getElementById('mobile-header-sub');
    if (elMobileSub) {
      const riskTxt = riskCount === 0 ? 'Todo al día' : `${riskCount} en alerta`;
      elMobileSub.textContent = `${state.courses.length} ramos · ${riskTxt}`;
    }

    const sideLinks = document.getElementById('sidebar-courses-links');
    if (sideLinks) {
      sideLinks.innerHTML = state.courses
        .map(
          (c) => `
          <button
            type="button"
            class="sidebar-link-btn ${selectedCourseId === c.id ? 'active' : ''}"
            data-action="open-course-grades"
            data-course-id="${c.id}"
            title="${escapeHtml(c.name)}"
          >
            ${escapeHtml(c.name)}
          </button>
        `
        )
        .join('');
    }

    ['home', 'promedios', 'asistencias', 'agregar', 'cuenta'].forEach((sec) => {
      document.getElementById(`tab-${sec}`)?.classList.toggle('active', currentSection === sec);
      document.getElementById(`redlink-${sec}`)?.classList.toggle('active', currentSection === sec);
      document.getElementById(`topcard-${sec}`)?.classList.toggle('active-card', currentSection === sec);
      document.getElementById(`bnav-${sec}`)?.classList.toggle('active', currentSection === sec);
    });
  }

  function renderAll() {
    renderSidebarAndNav();
    const container = document.getElementById('main-view-container');
    if (!container) return;

    if (currentSection === 'home') {
      container.innerHTML = renderHomeView();
    } else if (currentSection === 'promedios') {
      container.innerHTML = !selectedCourseId
        ? renderPromediosCourseList()
        : renderCourseGradesDetail(selectedCourseId);
    } else if (currentSection === 'asistencias') {
      container.innerHTML = !selectedCourseId
        ? renderAsistenciasCourseList()
        : renderCourseAttendanceDetail(selectedCourseId);
    } else if (currentSection === 'agregar') {
      container.innerHTML = renderAgregarRamoView();
    } else if (currentSection === 'cuenta') {
      container.innerHTML = renderAccountView();
    }
  }

  function formatDisplayCourseName(rawName) {
    return String(rawName || '').replace(/^\(TALCA\)\s*/i, '').trim();
  }

  /* ==========================================================================
     VISTA 1: INICIO (Grilla Circular Minimalista estilo Intranet Utalca)
     ========================================================================== */
  function renderHomeView() {
    const attCount = state.courses.filter((c) => c.attendance && c.attendance.enabled).length;
    return `
      <div class="section-nav-header">
        <div>
          <h2 class="section-nav-title">Servicios Académicos</h2>
          <div class="section-nav-sub">Selecciona una categoría para revisar tus ramos</div>
        </div>
      </div>

      <div class="circle-grid">
        <button type="button" class="circle-item" data-nav="promedios">
          <div class="circle-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 3v18h18"></path>
              <path d="M18 9l-5 5-4-4-3 3"></path>
            </svg>
          </div>
          <span class="circle-label">Promedios y Notas</span>
          <span class="circle-sub-meta">${state.courses.length} ramos inscritos</span>
        </button>

        <button type="button" class="circle-item" data-nav="asistencias">
          <div class="circle-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
          </div>
          <span class="circle-label">Control de Asistencias</span>
          <span class="circle-sub-meta">${attCount} ramos con asistencia</span>
        </button>

        <button type="button" class="circle-item" data-nav="agregar">
          <div class="circle-icon-wrap">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"></rect>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
          </div>
          <span class="circle-label">Importar Ramo</span>
          <span class="circle-sub-meta">Pantallazo o Copy-Paste</span>
        </button>

        <button type="button" class="circle-item" data-action="new-course">
          <div class="circle-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </div>
          <span class="circle-label">Crear Ramo Manual</span>
          <span class="circle-sub-meta">Personalizado</span>
        </button>

        <button type="button" class="circle-item" data-nav="cuenta">
          <div class="circle-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <span class="circle-label">Mi Cuenta</span>
          <span class="circle-sub-meta">Sesión y respaldo</span>
        </button>

        <button type="button" class="circle-item" data-action="export-data">
          <div class="circle-icon-wrap">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>
          <span class="circle-label">Respaldo de Datos</span>
          <span class="circle-sub-meta">Exportar JSON</span>
        </button>
      </div>
    `;
  }

  /* ==========================================================================
     VISTA 2A: PROMEDIOS -> Selección de Ramo
     ========================================================================== */
  function renderPromediosCourseList() {
    const itemsHtml = state.courses
      .map((course) => {
        const st = computeCourseStats(course);
        const completedFailed =
          st.isComplete &&
          st.effectiveFinalGrade !== null &&
          st.effectiveFinalGrade < st.passMark &&
          !st.acumPending;
        const mainDisplay = st.currentAvg !== null ? fmtGrade(st.currentAvg) : '—';
        const subTxt = st.hasFailedExigibleUnit
          ? 'Reprobado (Unidad Exigible)'
          : completedFailed
          ? 'Reprobado'
          : neededText(st.effectiveNeeded);
        const statColor =
          st.hasFailedExigibleUnit || completedFailed ? 'style="color:var(--danger);"' : '';

        return `
          <div class="circle-tile-container">
            <button
              type="button"
              class="circle-item"
              data-action="open-course-grades"
              data-course-id="${course.id}"
            >
              <div class="circle-icon-wrap">
                <span class="circle-big-stat" ${statColor}>${mainDisplay}</span>
              </div>
              <span class="circle-label">${escapeHtml(formatDisplayCourseName(course.name))}</span>
              <span class="circle-sub-meta">${subTxt}</span>
            </button>
            ${
              isDeleteModePromedios
                ? `<button
                    type="button"
                    class="circle-badge-delete"
                    data-action="delete-course"
                    data-course-id="${course.id}"
                    title="Eliminar ramo"
                    aria-label="Eliminar ramo"
                  ><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`
                : ''
            }
          </div>
        `;
      })
      .join('');

    return `
      <div class="section-nav-header">
        <div>
          <h2 class="section-nav-title">Promedios y Notas</h2>
          <div class="section-nav-sub">
            ${isDeleteModePromedios ? '<span style="color:var(--text-soft);">Toca la ✕ de un ramo para eliminarlo</span>' : 'Selecciona un ramo para revisar o editar sus porcentajes y notas'}
          </div>
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
          ${
            state.courses.length > 0
              ? `<button
                  type="button"
                  class="btn btn-sm ${isDeleteModePromedios ? 'btn-red' : ''}"
                  data-action="toggle-delete-promedios"
                  style="font-size:0.75rem; padding:0.28rem 0.65rem;"
                >
                  ${isDeleteModePromedios ? 'Listo' : 'Editar lista'}
                </button>`
              : ''
          }
          <button type="button" class="btn btn-red btn-sm" data-nav="agregar">+ Agregar Ramo</button>
        </div>
      </div>

      <div class="circle-grid">
        ${
          state.courses.length > 0
            ? itemsHtml
            : `<div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
                <p style="font-size: 0.95rem; font-weight: 500; margin-bottom: 0.75rem;">No tienes ramos registrados todavía.</p>
                <button type="button" class="btn btn-red btn-sm" data-nav="agregar">+ Importar o Crear Ramo</button>
              </div>`
        }
      </div>
    `;
  }

  /* ==========================================================================
     VISTA 3A: DETALLE DE NOTAS Y PORCENTAJES DE UN RAMO
     ========================================================================== */
  function renderCourseGradesDetail(courseId) {
    const course = state.courses.find((c) => c.id === courseId);
    if (!course) {
      selectedCourseId = null;
      return renderPromediosCourseList();
    }

    const st = computeCourseStats(course);
    const isMultiUnit = course.units.length > 1;
    const passMark = st.passMark;

    const unitsHtml = course.units
      .map((unit, uIdx) => {
        const uSt = st.unitStats[uIdx];
        const evalRowsHtml = unit.evals
          .map((ev, eIdx) => {
            const ec = uSt.evalComputed[eIdx];
            const g = ec.grade;
            const gradeClass = g === null ? '' : g >= passMark ? 'grade-pass' : 'grade-fail';
            const isSub = Boolean(ec.isSubdivided);
            const subAvgCls = ec.subAvg === null ? '' : ec.subAvg >= passMark ? 'grade-pass' : 'grade-fail';

            const subContainerHtml = isSub
              ? `
                <div class="sub-evals-container" data-sub-container="${course.id}-${unit.id}-${ev.id}">
                  ${renderSubEvalsListHtml(ev, ec, passMark, course.id, unit.id)}
                </div>
              `
              : '';

            const gradeSlotHtml = isSub
              ? `
                <div
                  class="grade-subavg-pill ${subAvgCls}"
                  data-eval-subavg="${course.id}-${unit.id}-${ev.id}"
                  title="${ec.subAvg !== null ? `Promedio sub-notas: ${ec.subAvg}` : 'Sin notas ingresadas aún'}"
                >${ec.subAvg !== null ? fmtGrade(ec.subAvg, 1) : '—'}</div>
              `
              : `
                <input
                  type="text"
                  inputmode="decimal"
                  placeholder=""
                  class="grade-input ${gradeClass}"
                  value="${g !== null ? g : ''}"
                  aria-label="Nota (1.0 a 7.0)"
                  data-action="edit-eval-grade"
                  data-course-id="${course.id}"
                  data-unit-id="${unit.id}"
                  data-eval-id="${ev.id}"
                />
              `;

            return `
              <div class="eval-row">
                <div class="eval-info">
                  <div
                    class="eval-name-input"
                    contenteditable="true"
                    spellcheck="false"
                    role="textbox"
                    aria-label="Nombre de evaluación"
                    data-action="edit-eval-name"
                    data-course-id="${course.id}"
                    data-unit-id="${unit.id}"
                    data-eval-id="${ev.id}"
                  >${escapeHtml(ev.name)}</div>
                  <div class="eval-meta" data-eval-meta="${course.id}-${unit.id}-${ev.id}">
                    ${renderEvalRowMetaInner(ev, ec, isMultiUnit, passMark, course.id, unit.id)}
                  </div>
                </div>

                <div class="input-group-compact" title="Porcentaje de la evaluación">
                  <input
                    type="text"
                    inputmode="decimal"
                    class="pct-input"
                    value="${ev.weight}"
                    aria-label="Porcentaje"
                    data-action="edit-eval-weight"
                    data-course-id="${course.id}"
                    data-unit-id="${unit.id}"
                    data-eval-id="${ev.id}"
                  />
                  <span class="pct-symbol">%</span>
                </div>

                ${gradeSlotHtml}
              </div>
              ${subContainerHtml}
            `;
          })
          .join('');

        return `
          <div class="unit-block">
            <div class="unit-header">
              <div style="display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem; min-width:0;">
                <div
                  class="unit-title-edit"
                  contenteditable="true"
                  spellcheck="false"
                  role="textbox"
                  data-action="edit-unit-name"
                  data-course-id="${course.id}"
                  data-unit-id="${unit.id}"
                  title="Toca para editar el nombre de la unidad"
                >${escapeHtml(unit.name)}</div>
                ${
                  isMultiUnit
                    ? `<span class="unit-weight-box" title="Peso de esta unidad en el ramo">
                        Peso unidad:
                        <input
                          type="text"
                          inputmode="decimal"
                          class="unit-weight-input"
                          value="${unit.weight}"
                          data-action="edit-unit-weight"
                          data-course-id="${course.id}"
                          data-unit-id="${unit.id}"
                        />%
                      </span>`
                    : ''
                }
                <span data-unit-badges="${course.id}-${unit.id}">
                  ${renderUnitBadgesInner(unit, uSt, passMark, course.id)}
                </span>
              </div>
              <div style="font-size:0.78rem;" data-unit-summary="${course.id}-${unit.id}">
                ${renderUnitSummaryPills(uSt, passMark)}
              </div>
            </div>

            <div class="eval-list">
              ${evalRowsHtml}
            </div>

            <div style="padding:0.55rem 0.9rem; background:var(--surface-subtle); border-top:1px solid var(--border); display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.4rem;">
              <button
                type="button"
                class="btn btn-sm"
                data-action="add-eval"
                data-course-id="${course.id}"
                data-unit-id="${unit.id}"
              >+ Evaluación</button>
              ${
                isMultiUnit
                  ? `<button type="button" class="btn btn-sm btn-ghost" style="color:var(--danger);" data-action="delete-unit" data-course-id="${course.id}" data-unit-id="${unit.id}">Eliminar Unidad</button>`
                  : ''
              }
            </div>
          </div>
        `;
      })
      .join('');

    const acumHtml = course.acumOpcional?.enabled
      ? `
        <div class="acum-box" data-acum-box="${course.id}">
          ${renderAcumBoxInner(course, st)}
        </div>
      `
      : '';

    return `
      <div class="section-nav-header">
        <button type="button" class="btn btn-sm" data-action="back-to-promedios">
          ← Volver a Ramos
        </button>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          ${
            course.attendance?.enabled
              ? `<button
                  type="button"
                  class="btn btn-sm"
                  data-action="open-course-attendance"
                  data-course-id="${course.id}"
                >Asistencia</button>`
              : ''
          }
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            style="color:var(--danger);"
            data-action="delete-course"
            data-course-id="${course.id}"
          >Eliminar Ramo</button>
        </div>
      </div>

      <h2 class="course-detail-title">
        ${escapeHtml(formatDisplayCourseName(course.name))}
      </h2>

      <div class="course-kpi-row" data-course-kpis="${course.id}">
        ${renderCourseKpisInner(st)}
      </div>

      ${unitsHtml}
      ${acumHtml}

      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.45rem; padding-top:0.5rem; border-top:1px solid var(--border);">
        <div style="display:flex; gap:0.45rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm" data-action="add-unit" data-course-id="${course.id}">
            ${course.units.length >= 2 ? '+ Agregar Unidad' : '+ Dividir en Unidad (50% / 50%)'}
          </button>
          <button type="button" class="btn btn-sm" data-action="toggle-acum" data-course-id="${course.id}">
            ${course.acumOpcional?.enabled ? 'Ocultar Acum. Opcional' : '+ Acum. Opcional (70/30)'}
          </button>
          <button type="button" class="btn btn-sm" data-action="toggle-attendance" data-course-id="${course.id}">
            ${course.attendance?.enabled ? 'Quitar Asistencia' : '+ Activar Asistencia'}
          </button>
        </div>
        <button type="button" class="btn btn-sm btn-ghost" data-action="toggle-passmark" data-course-id="${course.id}">
          Mínimo aprobación: ${course.passMark}
        </button>
      </div>
    `;
  }

  function renderEvalRowMetaInner(ev, ec, isMultiUnit, passMark, courseId, unitId) {
    const parts = [];
    if (ev.date) parts.push(`<span>${escapeHtml(ev.date)}</span>`);
    if (isMultiUnit) {
      parts.push(`<span>(${ec.courseSharePct}% del ramo)</span>`);
    }

    if (ec.isSubdivided) {
      parts.push(
        `<span class="badge badge-neutral" style="font-size:0.68rem;padding:0.1rem 0.35rem;">${ec.subCount} sub-notas (${ec.subEvalsComputed?.[0]?.unitSharePct || 0}% c/u)</span>`
      );
      if (ec.contribUnitPts !== null && ec.contribUnitPts > 0) {
        parts.push(
          `<span style="color:var(--text-soft);font-weight:600;">+${fmtPoints(
            ec.contribUnitPts
          )}</span>`
        );
      }
      if (ec.subGradedCount < ec.subCount && ec.neededUniform !== null) {
        const cls = neededBadgeClass(ec.neededUniform, passMark);
        parts.push(
          `<span class="badge ${cls}" style="font-size:0.68rem;padding:0.1rem 0.35rem;">Pendiente</span>`
        );
      }
      parts.push(
        `<button type="button" class="btn-sub-action" data-action="add-subeval" data-course-id="${courseId}" data-unit-id="${unitId}" data-eval-id="${ev.id}" style="padding:0.08rem 0.35rem;font-size:0.68rem;">+ Sub-nota</button>`
      );
      parts.push(
        `<button type="button" class="btn-sub-action" data-action="open-subdivide-modal" data-course-id="${courseId}" data-unit-id="${unitId}" data-eval-id="${ev.id}" style="padding:0.08rem 0.35rem;font-size:0.68rem;" title="Reconfigurar cantidad de sub-notas">Ajustar N</button>`
      );
    } else {
      if (ec.grade !== null) {
        parts.push(
          `<span style="color:var(--text-soft);font-weight:600;">+${fmtPoints(
            ec.contribUnitPts
          )}</span>`
        );
      } else if (ec.neededUniform !== null) {
        const cls = neededBadgeClass(ec.neededUniform, passMark);
        parts.push(
          `<span class="badge ${cls}">Necesitas: ${fmtGrade(Math.max(1.0, ec.neededUniform), 1)}</span>`
        );
      }
      parts.push(
        `<button type="button" class="btn-subdivide-trigger" data-action="open-subdivide-modal" data-course-id="${courseId}" data-unit-id="${unitId}" data-eval-id="${ev.id}" title="Dividir este porcentaje en varios controles o notas">÷ Subdividir %</button>`
      );
    }

    const course = state.courses.find((c) => c.id === courseId);
    const unit = course?.units?.find((u) => u.id === unitId);
    if (!unit || unit.evals.length > 1) {
      parts.push(
        `<button type="button" class="btn-ghost" style="padding:0 4px;font-size:0.7rem;color:var(--text-muted);cursor:pointer;" data-action="delete-eval" data-course-id="${courseId}" data-unit-id="${unitId}" data-eval-id="${ev.id}">Borrar</button>`
      );
    }
    return parts.join(' ');
  }

  function renderSubEvalsListHtml(ev, ec, passMark, courseId, unitId) {
    const subRows = (ev.subEvals || [])
      .map((sub, sIdx) => {
        const subEc = ec.subEvalsComputed?.[sIdx] || {};
        const sg = subEc.grade;
        const subGradeCls = sg === null ? '' : sg >= passMark ? 'grade-pass' : 'grade-fail';
        return `
          <div class="sub-eval-row" data-sub-row="${sub.id}">
            <div class="sub-eval-left">
              <span class="sub-eval-branch">↳</span>
              <div
                class="sub-eval-name-input"
                contenteditable="true"
                spellcheck="false"
                role="textbox"
                aria-label="Nombre de sub-nota"
                data-action="edit-subeval-name"
                data-course-id="${courseId}"
                data-unit-id="${unitId}"
                data-eval-id="${ev.id}"
                data-sub-id="${sub.id}"
              >${escapeHtml(sub.name)}</div>
              <span class="sub-eval-meta" data-sub-meta="${courseId}-${unitId}-${ev.id}-${sub.id}">
                ${renderSubEvalMetaInner(sub, subEc, passMark, courseId, unitId, ev.id)}
              </span>
            </div>
            <div class="sub-eval-right">
              <input
                type="text"
                inputmode="decimal"
                placeholder=""
                class="grade-input sub-grade-input ${subGradeCls}"
                value="${sg !== null ? sg : ''}"
                aria-label="Nota de ${escapeHtml(sub.name)}"
                data-action="edit-subeval-grade"
                data-course-id="${courseId}"
                data-unit-id="${unitId}"
                data-eval-id="${ev.id}"
                data-sub-id="${sub.id}"
              />
              <button
                type="button"
                class="sub-eval-del-btn"
                title="Eliminar esta sub-nota"
                data-action="delete-subeval"
                data-course-id="${courseId}"
                data-unit-id="${unitId}"
                data-eval-id="${ev.id}"
                data-sub-id="${sub.id}"
              ><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      ${subRows}
      <div class="sub-evals-footer">
        <div style="display:flex; gap:0.4rem; align-items:center;">
          <button
            type="button"
            class="btn-sub-action"
            data-action="add-subeval"
            data-course-id="${courseId}"
            data-unit-id="${unitId}"
            data-eval-id="${ev.id}"
          >+ Agregar sub-nota</button>
          <button
            type="button"
            class="btn-sub-action"
            data-action="open-subdivide-modal"
            data-course-id="${courseId}"
            data-unit-id="${unitId}"
            data-eval-id="${ev.id}"
          >Ajustar cantidad</button>
        </div>
        <button
          type="button"
          class="btn-sub-action"
          style="color:var(--text-muted);"
          data-action="unsubdivide-eval"
          data-course-id="${courseId}"
          data-unit-id="${unitId}"
          data-eval-id="${ev.id}"
        >Quitar subdivisión</button>
      </div>
    `;
  }

  function renderSubEvalMetaInner(sub, subEc, passMark, courseId, unitId, evalId) {
    const parts = [];
    parts.push(`<span>(${subEc.unitSharePct || 0}%)</span>`);
    if (subEc.grade !== null) {
      parts.push(
        `<span style="color:var(--text-soft);font-weight:600;">+${fmtPoints(subEc.contribUnitPts)}</span>`
      );
    } else if (subEc.neededUniform !== null) {
      const cls = neededBadgeClass(subEc.neededUniform, passMark);
      parts.push(
        `<span class="badge ${cls}" style="font-size:0.68rem;padding:0.1rem 0.35rem;">Necesitas: ${fmtGrade(Math.max(1.0, subEc.neededUniform), 1)}</span>`
      );
    }
    return parts.join(' ');
  }

  function renderUnitBadgesInner(unit, uSt, passMark, courseId) {
    let html = '';
    if (unit.exigible) {
      html += `<span class="badge badge-neutral">Exigible ≥ ${passMark}</span> `;
    }
    if (!uSt.isWeightValid) {
      html += `<span class="badge badge-warn">Suma ${uSt.rawTotalWeight}% (debe sumar ${uSt.expectedUnitSum}%)</span> `;
      html += `<button type="button" class="btn btn-sm" style="min-height:22px;padding:0.1rem 0.45rem;font-size:0.68rem;" data-action="normalize-unit-weights" data-course-id="${courseId}" data-unit-id="${unit.id}">Ajustar a 100%</button>`;
    } else {
      html += `<span class="badge badge-ok">100%</span>`;
    }
    return html;
  }

  /* ==========================================================================
     VISTA 2B: ASISTENCIAS -> Solo Ramos con Asistencia Exigible
     ========================================================================== */
  function renderAsistenciasCourseList() {
    const attendanceCourses = state.courses.filter((course) => course.attendance && course.attendance.enabled);

    const itemsHtml = attendanceCourses
      .map((course) => {
        const attSt = computeAttendanceStats(course.attendance);
        const pctDisplay = `${attSt.currentPct}%`;
        const subTxt = attSt.isAtRisk
          ? attSt.mustAttendNext === null
            ? 'No recuperable al 100%'
            : `Faltan ${attSt.mustAttendNext} clases`
          : `${attSt.attended}/${attSt.held} clases`;

        return `
          <div class="circle-tile-container">
            <button
              type="button"
              class="circle-item"
              data-action="open-course-attendance"
              data-course-id="${course.id}"
            >
              <div class="circle-icon-wrap">
                <span class="circle-big-stat">${pctDisplay}</span>
                <span class="circle-mini-sub">Mín ${attSt.minPct}%</span>
              </div>
              <span class="circle-label">${escapeHtml(formatDisplayCourseName(course.name))}</span>
              <span class="circle-sub-meta">${subTxt}</span>
            </button>
            ${
              isDeleteModeAsistencias
                ? `<button
                    type="button"
                    class="circle-badge-delete"
                    data-action="remove-attendance-from-list"
                    data-course-id="${course.id}"
                    title="Quitar de Asistencias"
                    aria-label="Quitar de Asistencias"
                  ><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`
                : ''
            }
          </div>
        `;
      })
      .join('');

    return `
      <div class="section-nav-header">
        <div>
          <h2 class="section-nav-title">Control de Asistencias</h2>
          <div class="section-nav-sub">
            ${isDeleteModeAsistencias ? '<span style="color:var(--text-soft);">Toca la ✕ para quitar un ramo de asistencias</span>' : `Ramos con requisito de asistencia exigible (${attendanceCourses.length})`}
          </div>
        </div>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
          ${
            attendanceCourses.length > 0
              ? `<button
                  type="button"
                  class="btn btn-sm ${isDeleteModeAsistencias ? 'btn-red' : ''}"
                  data-action="toggle-delete-asistencias"
                  style="font-size:0.75rem; padding:0.28rem 0.65rem;"
                >
                  ${isDeleteModeAsistencias ? 'Listo' : 'Editar lista'}
                </button>`
              : ''
          }
          <label class="btn btn-red btn-sm" for="att-screenshot-input" style="cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
            <span>📷 Subir Pantallazo o PDF</span>
            <input type="file" id="att-screenshot-input" accept="image/*,application/pdf" hidden />
          </label>
          <button type="button" class="btn btn-sm" data-action="paste-attendance-text">
            📋 Pegar Texto
          </button>
        </div>
      </div>

      <div id="att-ocr-status" class="ocr-status-box" hidden></div>
      <div id="att-ocr-preview" class="ocr-preview-box" hidden></div>

      ${
        attendanceCourses.length > 0
          ? `<div class="circle-grid">${itemsHtml}</div>`
          : `<p style="font-size:0.84rem; color:var(--text-muted); text-align:center; padding:2rem 0;">No hay ramos con asistencia activa.</p>`
      }
    `;
  }

  /* ==========================================================================
     VISTA 3B: DETALLE DE ASISTENCIA DE UN RAMO
     ========================================================================== */
  function renderCourseAttendanceDetail(courseId) {
    const course = state.courses.find((c) => c.id === courseId);
    if (!course) {
      selectedCourseId = null;
      return renderAsistenciasCourseList();
    }
    course.attendance = course.attendance || {
      enabled: true,
      minPct: 80,
      attended: 0,
      held: 0,
      totalEstimated: null
    };
    course.attendance.enabled = true;
    const attSt = computeAttendanceStats(course.attendance);

    return `
      <div class="section-nav-header">
        <button type="button" class="btn btn-sm" data-action="back-to-asistencias">
          ← Volver a Asistencias
        </button>
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
          <label class="btn btn-red btn-sm" for="course-att-screenshot-input" style="cursor:pointer; display:inline-flex; align-items:center; gap:0.35rem;">
            <span>📷 Actualizar con Pantallazo / PDF</span>
            <input type="file" id="course-att-screenshot-input" data-course-id="${course.id}" accept="image/*,application/pdf" hidden />
          </label>
          <button
            type="button"
            class="btn btn-sm"
            data-action="open-course-grades"
            data-course-id="${course.id}"
          >Ver Notas del Ramo</button>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            style="color:var(--text-muted); font-size:0.76rem;"
            data-action="remove-attendance-only"
            data-course-id="${course.id}"
          >Quitar de Asistencias</button>
        </div>
      </div>

      <div id="single-att-ocr-status" class="ocr-status-box" hidden></div>
      <div id="single-att-ocr-preview" class="ocr-preview-box" hidden></div>

      <h2 class="course-detail-title">
        ${escapeHtml(formatDisplayCourseName(course.name))}
      </h2>

      <div class="attendance-box" data-att-box="${course.id}">
        ${renderAttendanceBoxInner(course, attSt)}
      </div>
    `;
  }

  /* ==========================================================================
     VISTA 4: AGREGAR / IMPORTAR RAMO
     ========================================================================== */
  function renderAgregarRamoView() {
    return `
      <div class="section-nav-header">
        <div>
          <h2 class="section-nav-title">Agregar o Importar Ramo</h2>
          <div class="section-nav-sub">Sube un pantallazo de tus porcentajes o pega el texto de la intranet</div>
        </div>
        <button type="button" class="btn btn-sm" data-action="new-course">+ Ramo Manual</button>
      </div>

      <div class="import-actions-grid">
        <label class="upload-tile" for="screenshot-file-input">
          <span>Subir Pantallazo</span>
          <span class="sub">Elegir de Fotos (iPhone) o PC</span>
          <input type="file" id="screenshot-file-input" accept="image/*" hidden />
        </label>

        <button type="button" class="upload-tile" data-action="paste-clipboard">
          <span>Pegar Texto Copiado</span>
          <span class="sub">Desde el portapapeles</span>
        </button>
      </div>

      <textarea
        id="import-textarea"
        class="paste-textarea"
        placeholder="Pega aquí las filas de la intranet o escribe ej:&#10;Informe 25%&#10;Laboratorio 10% 6.5&#10;Presentación 35%"
      ></textarea>

      <div style="display:flex; gap:0.45rem; flex-wrap:wrap; margin-top:0.65rem;">
        <button type="button" class="btn btn-sm" data-action="load-sample-1">
          Cargar Ejemplo 1 (Módulo I: Investigación)
        </button>
        <button type="button" class="btn btn-sm" data-action="load-sample-2">
          Cargar Ejemplo 2 (Fundamentos de Psicoterapia I)
        </button>
      </div>

      <div id="ocr-status" class="ocr-status-box" hidden></div>
      <div id="import-preview-area" class="ocr-preview-box" hidden></div>
    `;
  }

  /* ==========================================================================
     VISTA 5: MI CUENTA (sesión, modo y respaldo)
     ========================================================================== */
  function renderAccountView() {
    const mode = window.NotasCloud ? window.NotasCloud.getMode() : 'demo';
    const modeLabel = window.NotasCloud ? window.NotasCloud.getModeLabel() : 'Sesión local';
    const rut = currentUser?.rut || '';
    const maskedRut = window.AuthUtils ? window.AuthUtils.maskRut(rut) : '—';

    return `
      <div class="section-nav-header">
        <div>
          <h2 class="section-nav-title">Mi Cuenta</h2>
          <div class="section-nav-sub">Sesión, respaldo y datos personales</div>
        </div>
        <button type="button" class="btn btn-sm" data-action="logout">Cerrar sesión</button>
      </div>

      <div class="account-card">
        <div class="account-row">
          <span>RUT</span>
          <strong>${escapeHtml(maskedRut)}</strong>
        </div>
        <div class="account-row">
          <span>Modo</span>
          <strong>${escapeHtml(modeLabel)}</strong>
        </div>
        <div class="account-row">
          <span>Ramos</span>
          <strong>${state.courses.length}</strong>
        </div>
      </div>

      ${
        mode === 'demo'
          ? `<div class="account-warning">
              <strong>Modo demo local.</strong> Las cuentas y los ramos se guardan solo en este navegador.
              Para cuentas reales, cierra sesión y pulsa <strong>Conectar con Supabase</strong> en la pantalla de inicio.
            </div>`
          : `<div class="account-ok">Conectado a Supabase. Tus datos se guardan en la nube y se sincronizan entre dispositivos.</div>`
      }

      <div class="account-actions">
        <button type="button" class="btn" data-action="export-data">Exportar respaldo JSON</button>
        <label class="btn" for="import-json-input">Importar respaldo JSON</label>
        <input type="file" id="import-json-input" accept="application/json,.json" hidden />
        ${
          mode === 'demo'
            ? `<button type="button" class="btn" data-action="reset-demo">Cargar ramos de ejemplo</button>`
            : `<button type="button" class="btn" data-action="reload-cloud">Recargar desde la nube</button>`
        }
        <button type="button" class="btn btn-danger-outline" data-action="delete-all-courses">Borrar todos mis ramos</button>
      </div>

      <p class="account-help">
        El respaldo JSON incluye todos tus ramos y notas. Guárdalo antes de cambiar de dispositivo.
        ${
          mode === 'demo'
            ? 'En modo demo no hay recuperación de contraseña ni sincronización entre dispositivos.'
            : 'Si olvidaste tu contraseña, contacta al administrador para restablecerla.'
        }
      </p>
    `;
  }

  function renderUnitSummaryPills(uSt, passMark) {
    const unitAvg = uSt.currentAvg !== null ? uSt.currentAvg : null;
    const ptsTxt =
      unitAvg !== null
        ? `Nota: <strong>${fmtGrade(unitAvg, 2)}</strong> <span style="color:var(--text-muted);font-size:0.7rem;">(${fmtPoints(
            uSt.points
          )} pts)</span>`
        : `Puntos: <strong>${fmtPoints(uSt.points)}</strong>`;
    let needBadge = '';
    if (uSt.neededUniform !== null) {
      const cls = neededBadgeClass(uSt.neededUniform, passMark);
      const label =
        uSt.neededUniform <= 1.0
          ? 'Aprobada'
          : uSt.neededUniform > 7.0
          ? `Falta ${fmtGrade(uSt.neededUniform, 1)} (>7.0)`
          : `Necesitas ${fmtGrade(uSt.neededUniform, 1)}`;
      needBadge = `<span class="badge ${cls}">${label}</span>`;
    } else {
      const cls = uSt.points >= passMark ? 'badge-ok' : 'badge-danger';
      needBadge = `<span class="badge ${cls}">Nota Unidad: ${fmtGrade(uSt.points, 2)}</span>`;
    }
    return `<span>${ptsTxt}</span> ${needBadge}`;
  }

  function renderCourseKpisInner(st) {
    let neededVal = '—';
    let neededSub = '100% evaluado';
    let neededColor = 'var(--text)';

    const completedFailed =
      st.isComplete &&
      st.effectiveFinalGrade !== null &&
      st.effectiveFinalGrade < st.passMark &&
      !st.acumPending;

    if (st.hasFailedExigibleUnit) {
      neededVal = 'Reprobado';
      neededSub = st.exigibleWarningUnit
        ? `Unidad ${st.exigibleWarningUnit.slice(0, 22)} < ${st.passMark}`
        : `Unidad exigible < ${st.passMark}`;
      neededColor = 'var(--danger)';
    } else if (completedFailed) {
      neededVal = 'Reprobado';
      neededSub = `Ramo terminado bajo ${st.passMark}`;
      neededColor = 'var(--danger)';
    } else if (st.isComplete && st.acumPending) {
      neededVal =
        st.neededInAcum !== null ? fmtGrade(Math.max(1, st.neededInAcum), 1) : '—';
      neededSub = 'Nota necesaria en la Acumulativa';
      neededColor =
        st.neededInAcum === null
          ? 'var(--text-muted)'
          : st.neededInAcum <= st.passMark
          ? 'var(--ok)'
          : st.neededInAcum <= 6.0
          ? 'var(--warn)'
          : 'var(--danger)';
    } else if (st.effectiveNeeded !== null) {
      if (st.effectiveNeeded <= 1.0) {
        neededVal = '≤ 1.0';
        neededSub = 'Ramo ya aprobado';
        neededColor = 'var(--ok)';
      } else if (st.effectiveNeeded > 7.0) {
        neededVal = fmtGrade(st.effectiveNeeded, 1);
        neededSub = 'Requiere Acumulativa';
        neededColor = 'var(--danger)';
      } else {
        neededVal = fmtGrade(st.effectiveNeeded, 1);
        neededSub = st.exigibleWarningUnit
          ? `Exigido en ${st.exigibleWarningUnit.slice(0, 22)}`
          : `En el ${st.globalPendingWeight}% pendiente`;
        neededColor =
          st.effectiveNeeded <= st.passMark
            ? 'var(--ok)'
            : st.effectiveNeeded <= 5.4
            ? 'var(--warn)'
            : 'var(--danger)';
      }
    }

    const displayAvg = st.currentAvg !== null ? st.currentAvg : null;
    const ptsColor = st.hasFailedExigibleUnit || completedFailed
      ? 'var(--danger)'
      : displayAvg === null
      ? 'var(--text-muted)'
      : displayAvg >= st.passMark
      ? 'var(--ok)'
      : 'var(--text)';

    return `
      <div class="kpi-item">
        <span class="kpi-label">Nota Actual</span>
        <span class="kpi-val" style="color:${ptsColor}">${
          displayAvg !== null ? fmtGrade(displayAvg, 2) : '—'
        }</span>
        <span class="kpi-note">Meta: ${st.passMark} (${st.globalGradedWeight}% evaluado) · ${fmtPoints(
      st.globalPoints
    )} pts</span>
      </div>
      <div class="kpi-item">
        <span class="kpi-label">Nota Necesaria</span>
        <span class="kpi-val" style="color:${neededColor}">${neededVal}</span>
        <span class="kpi-note">${escapeHtml(neededSub)}</span>
      </div>
    `;
  }

  function renderAcumBoxInner(course, st) {
    const acum = course.acumOpcional;
    const g = normalizeGrade(acum.grade);
    const needNow = st.neededInAcum;
    const needWithPoints = st.neededInAcumWithCurrentPointsOnly;

    let msg = '';
    if (g !== null && st.finalWithAcum !== null) {
      const ok = st.finalWithAcum >= st.passMark;
      msg = `Nota Final (70% Presentación + 30% Acumulativa): <strong style="color:${
        ok ? 'var(--ok)' : 'var(--danger)'
      }">${fmtGrade(st.finalWithAcum)}</strong>`;
    } else if (needNow !== null) {
      msg = `Con tu promedio actual (${fmtGrade(
        st.currentAvg
      )} = 70%), necesitas un <strong>${fmtGrade(
        Math.max(1.0, needNow)
      )}</strong> en la Acumulativa (30%) para aprobar con ${st.passMark}.`;
    } else {
      msg = `El 100% del ramo pondera <strong>70%</strong> y este Examen Acumulativo vale <strong>${acum.weight}%</strong> (solo con los puntos actuales necesitarías <strong>${fmtGrade(
        Math.max(1.0, needWithPoints)
      )}</strong>).`;
    }

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.4rem;">
        <div style="font-weight:600; font-size:0.84rem; color:var(--red);">
          Examen Acumulativo Opcional Global (70% / ${acum.weight}%)
          ${acum.date ? `<span class="badge badge-neutral" style="margin-left:0.35rem;">${escapeHtml(acum.date)}</span>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:0.4rem;">
          <span style="font-size:0.75rem; color:var(--text-muted);">Examen:</span>
          <input
            type="text"
            inputmode="decimal"
            placeholder=""
            class="grade-input"
            style="width:52px; height:34px;"
            value="${g !== null ? g : ''}"
            data-action="edit-acum-grade"
            data-course-id="${course.id}"
          />
        </div>
      </div>
      <div style="font-size:0.79rem; color:var(--text-soft);">
        ${msg}
      </div>
    `;
  }

  function renderAttendanceBoxInner(course, attSt) {
    const statusCls = attSt.isAtRisk ? 'badge-danger' : 'badge-ok';
    let adviceHtml = '';

    if (attSt.held === 0) {
      adviceHtml = `Usa los botones para registrar cada clase realizada y calcular tu margen sobre el ${attSt.minPct}%.`;
    } else if (attSt.isAtRisk) {
      if (attSt.mustAttendNext === null) {
        adviceHtml = `Estás bajo el 100% de asistencia requerida. No es posible recuperar el 100% debido a inasistencias previas.`;
      } else {
        adviceHtml = `Estás bajo el ${attSt.minPct}%. Debes asistir a las próximas <strong>${attSt.mustAttendNext} clases seguidas</strong> para alcanzar el ${attSt.minPct}%.`;
      }
    } else {
      adviceHtml = `Cumples el requisito. Actualmente puedes faltar a <strong>${attSt.canMissConsecutiveNow} clase(s) seguida(s)</strong> sin bajar del ${attSt.minPct}%.`;
    }

    if (attSt.remainingAbsencesSemester !== null) {
      const rem = attSt.remainingAbsencesSemester;
      adviceHtml += `<br/><span style="color:var(--text-muted);">De ${
        attSt.totalEstimated
      } clases totales del semestre, el máximo permitido de inasistencias es ${
        attSt.maxAbsencesSemester
      } (<strong>${
        rem >= 0 ? `te quedan ${rem} disponibles` : `excedido por ${Math.abs(rem)}`
      }</strong>).</span>`;
    }

    return `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <strong style="font-size:0.88rem; color:var(--red); font-weight:600;">
          Asistencia Exigible (Mínimo ${attSt.minPct}%)
        </strong>
        <span class="badge ${statusCls}">
          ${attSt.currentPct}% (${attSt.attended}/${attSt.held} clases)
        </span>
      </div>

      <div class="attendance-controls">
        <button type="button" class="att-btn att-btn-present" data-action="att-present" data-course-id="${course.id}">
          +1 Asistí hoy
        </button>
        <button type="button" class="att-btn att-btn-absent" data-action="att-absent" data-course-id="${course.id}">
          +1 Falté hoy
        </button>
      </div>

      <div class="attendance-inputs-row">
        <div class="att-mini-field">
          <label>Clases Asistidas</label>
          <input
            type="number"
            inputmode="numeric"
            min="0"
            value="${attSt.attended}"
            data-action="att-edit-attended"
            data-course-id="${course.id}"
          />
        </div>
        <div class="att-mini-field">
          <label>Clases Realizadas</label>
          <input
            type="number"
            inputmode="numeric"
            min="0"
            value="${attSt.held}"
            data-action="att-edit-held"
            data-course-id="${course.id}"
          />
        </div>
        <div class="att-mini-field">
          <label>Total Semestre (Opc.)</label>
          <input
            type="number"
            inputmode="numeric"
            min="0"
            placeholder="Ej: 30"
            value="${attSt.totalEstimated !== null ? attSt.totalEstimated : ''}"
            data-action="att-edit-total"
            data-course-id="${course.id}"
          />
        </div>
      </div>

      <div style="font-size:0.8rem; color:var(--text-soft); line-height:1.45;">
        ${adviceHtml}
      </div>

      <div style="margin-top:0.85rem; padding-top:0.75rem; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <button type="button" class="btn btn-sm btn-ghost" style="color:var(--text-muted); font-size:0.75rem;" data-action="remove-attendance-only" data-course-id="${course.id}">
          Desactivar asistencia en este ramo
        </button>
        <button type="button" class="btn btn-sm btn-ghost" style="color:var(--danger); font-size:0.75rem;" data-action="delete-course" data-course-id="${course.id}">
          Eliminar ramo
        </button>
      </div>
    `;
  }

  /**
   * Actualiza absolutamente todos los cálculos en pantalla en tiempo real
   * (incluyendo los puntos/+meta de cada fila y los % de cada unidad) sin perder el foco del teclado.
   */
  function refreshCourseComputedUI(courseId) {
    renderSidebarAndNav();
    const course = state.courses.find((c) => c.id === courseId);
    if (!course) return;
    const st = computeCourseStats(course);
    const isMultiUnit = course.units.length > 1;

    const kpiEl = document.querySelector(`[data-course-kpis="${courseId}"]`);
    if (kpiEl) kpiEl.innerHTML = renderCourseKpisInner(st);

    course.units.forEach((u, idx) => {
      const uSt = st.unitStats[idx];
      const sumEl = document.querySelector(`[data-unit-summary="${courseId}-${u.id}"]`);
      if (sumEl) sumEl.innerHTML = renderUnitSummaryPills(uSt, st.passMark);

      const badgesEl = document.querySelector(`[data-unit-badges="${courseId}-${u.id}"]`);
      if (badgesEl) badgesEl.innerHTML = renderUnitBadgesInner(u, uSt, st.passMark, courseId);

      u.evals.forEach((ev, eIdx) => {
        const ec = uSt.evalComputed[eIdx];
        const metaEl = document.querySelector(`[data-eval-meta="${courseId}-${u.id}-${ev.id}"]`);
        if (metaEl && ec) {
          metaEl.innerHTML = renderEvalRowMetaInner(
            ev,
            ec,
            isMultiUnit,
            st.passMark,
            courseId,
            u.id
          );
        }

        if (ec && ec.isSubdivided) {
          const subAvgEl = document.querySelector(`[data-eval-subavg="${courseId}-${u.id}-${ev.id}"]`);
          if (subAvgEl) {
            subAvgEl.textContent = ec.subAvg !== null ? fmtGrade(ec.subAvg, 1) : '—';
            subAvgEl.classList.remove('grade-pass', 'grade-fail');
            if (ec.subAvg !== null) {
              subAvgEl.classList.add(ec.subAvg >= st.passMark ? 'grade-pass' : 'grade-fail');
            }
          }

          ev.subEvals?.forEach((sub, sIdx) => {
            const subEc = ec.subEvalsComputed?.[sIdx];
            const subMetaEl = document.querySelector(
              `[data-sub-meta="${courseId}-${u.id}-${ev.id}-${sub.id}"]`
            );
            if (subMetaEl && subEc) {
              subMetaEl.innerHTML = renderSubEvalMetaInner(
                sub,
                subEc,
                st.passMark,
                courseId,
                u.id,
                ev.id
              );
            }
          });
        }
      });
    });

    const acumEl = document.querySelector(`[data-acum-box="${courseId}"]`);
    if (acumEl && course.acumOpcional?.enabled) {
      acumEl.innerHTML = renderAcumBoxInner(course, st);
    }

    const attEl = document.querySelector(`[data-att-box="${courseId}"]`);
    if (attEl) {
      attEl.innerHTML = renderAttendanceBoxInner(course, st.attendanceStats);
    }
  }

  /* ==========================================================================
     Importación con Pre-procesamiento de Imagen (Upscale 2.5x + Contraste) para OCR
     ========================================================================== */
  function updateImportPreview(rawText) {
    const parsed = UtalcaParser.parse(rawText);
    pendingImportCourse = parsed;
    const previewEl = document.getElementById('import-preview-area');
    if (!previewEl) return;

    const totalEvals = parsed.units.reduce((acc, u) => acc + u.evals.length, 0);
    const unitsDesc = parsed.units
      .map(
        (u) =>
          `<li><strong>${escapeHtml(u.name)} (${u.weight}%)</strong>: ${u.evals
            .map((e) => `${escapeHtml(e.name)} (${e.weight}%${e.grade ? ` · Nota ${e.grade}` : ''})`)
            .join(', ')}</li>`
      )
      .join('');

    previewEl.hidden = false;
    previewEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.55rem;">
        <label style="font-size:0.74rem; color:var(--red); font-weight:600;">RAMO DETECTADO (PUEDES EDITAR EL NOMBRE):</label>
        <input type="text" id="preview-course-name" class="text-input" value="${escapeHtml(parsed.name)}" />
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-top:0.15rem;">
          <span class="badge badge-red">${parsed.units.length} Unidad(es)</span>
          <span class="badge badge-ok">${totalEvals} Evaluaciones</span>
          ${
            parsed.acumOpcional.enabled
              ? `<span class="badge badge-neutral">Acum. Opcional (${parsed.acumOpcional.weight}%)</span>`
              : ''
          }
          ${
            parsed.attendance.enabled
              ? `<span class="badge badge-warn">Asistencia (${parsed.attendance.minPct}% mín)</span>`
              : ''
          }
        </div>
        <ul style="margin:0.25rem 0; padding-left:1.2rem; font-size:0.79rem; color:var(--text-soft);">
          ${unitsDesc}
        </ul>
        <button type="button" class="btn btn-red" id="confirm-import-btn" style="width:100%;">
          Guardar y Abrir Ramo
        </button>
      </div>
    `;

    const confirmBtn = document.getElementById('confirm-import-btn');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        const nameInput = document.getElementById('preview-course-name');
        if (nameInput && nameInput.value.trim()) {
          pendingImportCourse.name = nameInput.value.trim();
        }
        state.courses.unshift(pendingImportCourse);
        saveState();
        navigateTo('promedios', pendingImportCourse.id);
      };
    }
  }

  /**
   * Mejora la nitidez y resolución de pantallazos pequeños antes de pasarlos a Tesseract OCR
   */
  function preprocessImageForOcr(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = img.width < 1400 ? 2.5 : 1.5;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.filter = 'grayscale(100%) contrast(145%)';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob || file), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  async function runOcrOnImageFile(file) {
    if (!file) return;
    const statusEl = document.getElementById('ocr-status');
    const textarea = document.getElementById('import-textarea');
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = 'Procesando imagen para lectura de porcentajes...';
    }

    try {
      if (!window.Tesseract) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const enhancedBlob = await preprocessImageForOcr(file);
      const result = await window.Tesseract.recognize(enhancedBlob, 'spa+eng', {
        logger: (m) => {
          if (statusEl && m.status === 'recognizing text') {
            statusEl.textContent = `Leyendo porcentajes del pantallazo (${Math.round(
              (m.progress || 0) * 100
            )}%)...`;
          }
        }
      });
      const text = result?.data?.text || '';
      if (textarea) textarea.value = text;
      if (statusEl) statusEl.textContent = 'Pantallazo leído. Verifica la vista previa abajo:';
      updateImportPreview(text);
    } catch {
      if (statusEl) {
        statusEl.textContent = 'No se pudo cargar el lector OCR. Pega el texto copiado de la tabla.';
      }
    }
  }

  async function runAttendanceOcrOnImageFile(file, targetCourseId = null) {
    if (!file) return;
    const statusEl = document.getElementById(targetCourseId ? 'single-att-ocr-status' : 'att-ocr-status');
    const previewEl = document.getElementById(targetCourseId ? 'single-att-ocr-preview' : 'att-ocr-preview');
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.style.display = 'block';
      statusEl.textContent = 'Procesando archivo para lectura de asistencia...';
    }
    if (previewEl) {
      previewEl.hidden = true;
      previewEl.style.display = 'none';
      previewEl.innerHTML = '';
    }

    try {
      let text = '';
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        if (!window.pdfjsLib) {
          if (statusEl) statusEl.textContent = 'Cargando lector de PDF...';
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            s.onload = () => {
              window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
              resolve();
            };
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        if (statusEl) statusEl.textContent = 'Leyendo documento PDF de la Utalca...';
        const buffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        let pdfText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          let lastY = null;
          let pageText = '';
          for (const item of content.items) {
            const currentY = item.transform ? Math.round(item.transform[5]) : null;
            if (lastY !== null && currentY !== null && Math.abs(currentY - lastY) > 3) {
              pageText += '\n';
            } else if (pageText && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
              pageText += ' ';
            }
            pageText += item.str;
            lastY = currentY;
          }
          pdfText += pageText + '\n';
        }
        text = pdfText;
      } else {
        if (!window.Tesseract) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        const enhancedBlob = await preprocessImageForOcr(file);
        const result = await window.Tesseract.recognize(enhancedBlob, 'spa+eng', {
          logger: (m) => {
            if (statusEl && m.status === 'recognizing text') {
              statusEl.textContent = `Leyendo asistencias (${Math.round((m.progress || 0) * 100)}%)...`;
            }
          }
        });
        text = result?.data?.text || '';
      }

      const detected = extractAttendanceData(text, targetCourseId);

      if (detected.length === 0) {
        if (statusEl) {
          statusEl.textContent = 'No se detectaron datos claros de asistencia en el documento. Puedes ingresarlos manualmente abajo.';
        }
        return;
      }

      if (statusEl) {
        statusEl.textContent = `¡Listo! Se detectaron datos de asistencia (${detected.length} ramo${detected.length > 1 ? 's' : ''}):`;
      }

      if (previewEl) {
        previewEl.hidden = false;
        previewEl.style.display = 'block';
        previewEl.innerHTML = `
          <div style="font-weight:700; color:var(--red); font-size:0.9rem; margin-bottom:0.5rem;">
            🎓 Asistencia detectada de la Utalca:
          </div>
          <div style="display:flex; flex-direction:column; gap:0.65rem; width:100%; max-width:100%;">
            ${detected
              .map(
                (d, idx) => `
                <div class="att-result-card">
                  <div class="att-result-header">
                    <div style="margin-bottom:0.25rem;">
                      ${d.courseCode ? `<strong style="color:var(--red);">${escapeHtml(d.courseCode)}</strong> · ` : ''}
                      <strong>${d.attended}</strong> clases asistidas de <strong>${d.held}</strong> realizadas · <strong>${d.pct}%</strong>
                      <span style="color:var(--text-muted); font-size:0.72rem;">(Mín ${d.minPct}%)</span>
                    </div>
                    ${
                      d.classDates && d.classDates.length > 0
                        ? `<div style="font-size:0.71rem; color:var(--text-muted); line-height:1.35; word-break:break-word;">
                            ${d.classDates.length} clases detectadas: ${d.classDates.slice(0, 4).map((cd) => `${cd.date} (${cd.status})`).join(', ')}${d.classDates.length > 4 ? '...' : ''}
                          </div>`
                        : ''
                    }
                  </div>
                  <div class="att-result-assign-box">
                    <label class="att-result-label">Asignar al ramo:</label>
                    <div class="att-result-actions">
                      <select id="att-select-course-${idx}" class="att-result-select">
                        ${state.courses
                          .map(
                            (c) => `
                          <option value="${c.id}" ${c.id === d.course.id ? 'selected' : ''}>
                            ${escapeHtml(formatDisplayCourseName(c.name))}
                          </option>
                        `
                          )
                          .join('')}
                      </select>
                      <button
                        type="button"
                        class="btn btn-sm btn-red att-result-btn"
                        data-action="apply-selected-attendance"
                        data-select-id="att-select-course-${idx}"
                        data-att="${d.attended}"
                        data-held="${d.held}"
                        data-min="${d.minPct}"
                      >
                        Aplicar Asistencia
                      </button>
                    </div>
                  </div>
                </div>
              `
              )
              .join('')}
          </div>
        `;
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = 'Error al procesar el archivo. Asegúrate de subir una imagen o PDF válido de la Utalca.';
      }
    }
  }

  /* ==========================================================================
     Eventos Globales
     ========================================================================== */
  function setupEvents() {
    const mainContainer = document.getElementById('main-view-container');

    document.body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'subdivide-custom-count' || t.id === 'subdivide-base-name') {
        const course = state.courses.find((c) => c.id === subdivideTarget.courseId);
        const unit = course?.units.find((u) => u.id === subdivideTarget.unitId);
        const ev = unit?.evals.find((item) => item.id === subdivideTarget.evalId);
        if (ev) {
          const countInput = document.getElementById('subdivide-custom-count');
          const nameInput = document.getElementById('subdivide-base-name');
          const count = parseInt(countInput?.value, 10) || 4;
          const baseName = nameInput?.value.trim() || 'Control';
          document.querySelectorAll('.quick-num-btn').forEach((btn) => {
            btn.classList.toggle('active', parseInt(btn.dataset.count, 10) === count);
          });
          updateSubdividePreview(ev.weight, count, baseName);
        }
      }
    });

    mainContainer.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'import-textarea') {
        if (t.value.trim()) updateImportPreview(t.value);
        return;
      }

      const action = t.dataset.action;
      if (!action) return;
      const course = state.courses.find((c) => c.id === t.dataset.courseId);
      if (!course) return;

      if (
        action === 'edit-eval-grade' ||
        action === 'edit-eval-weight' ||
        action === 'edit-eval-name' ||
        action === 'edit-subeval-name' ||
        action === 'edit-subeval-grade'
      ) {
        const unit = course.units.find((u) => u.id === t.dataset.unitId);
        const ev = unit?.evals.find((item) => item.id === t.dataset.evalId);
        if (!ev) return;

        if (action === 'edit-eval-grade') {
          const g = normalizeGrade(t.value);
          ev.grade = g;
          t.classList.remove('grade-pass', 'grade-fail');
          if (g !== null) {
            t.classList.add(g >= (course.passMark || 3.95) ? 'grade-pass' : 'grade-fail');
          }
        } else if (action === 'edit-eval-weight') {
          const parsedW = parseFloat(t.value.replace(',', '.'));
          ev.weight = Number.isNaN(parsedW) ? 0 : Math.max(0, parsedW);
        } else if (action === 'edit-eval-name') {
          ev.name = (t.textContent ?? t.value ?? '').trim();
        } else if (action === 'edit-subeval-name') {
          const sub = ev.subEvals?.find((s) => s.id === t.dataset.subId);
          if (sub) sub.name = (t.textContent ?? t.value ?? '').trim();
        } else if (action === 'edit-subeval-grade') {
          const sub = ev.subEvals?.find((s) => s.id === t.dataset.subId);
          if (sub) {
            const sg = normalizeGrade(t.value);
            sub.grade = sg;
            t.classList.remove('grade-pass', 'grade-fail');
            if (sg !== null) {
              t.classList.add(sg >= (course.passMark || 3.95) ? 'grade-pass' : 'grade-fail');
            }
          }
        }
        saveState();
        refreshCourseComputedUI(course.id);
      } else if (action === 'edit-unit-name' || action === 'edit-unit-weight') {
        const unit = course.units.find((u) => u.id === t.dataset.unitId);
        if (!unit) return;
        if (action === 'edit-unit-name') {
          unit.name = (t.textContent ?? t.value ?? '').trim();
        } else {
          const parsedUW = parseFloat(t.value.replace(',', '.'));
          unit.weight = Number.isNaN(parsedUW) ? 0 : Math.max(0, parsedUW);
        }
        saveState();
        refreshCourseComputedUI(course.id);
      } else if (action === 'edit-acum-grade') {
        course.acumOpcional.grade = normalizeGrade(t.value);
        saveState();
        refreshCourseComputedUI(course.id);
      } else if (
        action === 'att-edit-attended' ||
        action === 'att-edit-held' ||
        action === 'att-edit-total'
      ) {
        if (action === 'att-edit-attended') {
          course.attendance.attended = Math.max(0, parseInt(t.value, 10) || 0);
          if (course.attendance.held < course.attendance.attended) {
            course.attendance.held = course.attendance.attended;
          }
        } else if (action === 'att-edit-held') {
          course.attendance.held = Math.max(course.attendance.attended, parseInt(t.value, 10) || 0);
        } else if (action === 'att-edit-total') {
          const val = parseInt(t.value, 10);
          course.attendance.totalEstimated = val > 0 ? val : null;
        }
        saveState();
        renderSidebarAndNav();
      }
    });

    mainContainer.addEventListener(
      'blur',
      (e) => {
        const t = e.target;
        if (
          t.dataset.action === 'edit-eval-grade' ||
          t.dataset.action === 'edit-acum-grade' ||
          t.dataset.action === 'edit-subeval-grade'
        ) {
          const rawVal = t.value.trim();
          if (rawVal !== '') {
            const g = normalizeGrade(rawVal);
            if (g !== null) {
              t.value = String(g);
              t.classList.remove('grade-invalid');
            } else {
              t.value = '';
              t.classList.remove('grade-pass', 'grade-fail');
              t.classList.add('grade-invalid');
              setTimeout(() => t.classList.remove('grade-invalid'), 1200);
            }
          }
          saveState(true);
        } else if (
          t.dataset.action === 'att-edit-attended' ||
          t.dataset.action === 'att-edit-held' ||
          t.dataset.action === 'att-edit-total'
        ) {
          saveState(true);
          refreshCourseComputedUI(t.dataset.courseId);
        }
      },
      true
    );

    mainContainer.addEventListener('change', async (e) => {
      const target = e.target;

      if (target.id === 'screenshot-file-input') {
        const file = target.files?.[0];
        target.value = '';
        if (file) runOcrOnImageFile(file);
      } else if (target.id === 'att-screenshot-input') {
        const file = target.files?.[0];
        target.value = '';
        if (file) runAttendanceOcrOnImageFile(file, null);
      } else if (target.id === 'course-att-screenshot-input') {
        const file = target.files?.[0];
        const cId = target.dataset.courseId;
        target.value = '';
        if (file) runAttendanceOcrOnImageFile(file, cId);
      } else if (target.id === 'import-json-input') {
        const file = target.files?.[0];
        target.value = '';
        await handleImportJson(file);
      }
    });

    document.body.addEventListener('click', async (e) => {
      // Clic en botones rápidos de cantidad en el modal de subdivisión
      const quickBtn = e.target.closest('.quick-num-btn');
      if (quickBtn) {
        const count = parseInt(quickBtn.dataset.count, 10);
        const countInput = document.getElementById('subdivide-custom-count');
        const nameInput = document.getElementById('subdivide-base-name');
        if (countInput) countInput.value = count;
        document.querySelectorAll('.quick-num-btn').forEach((b) => b.classList.remove('active'));
        quickBtn.classList.add('active');
        const course = state.courses.find((c) => c.id === subdivideTarget.courseId);
        const unit = course?.units.find((u) => u.id === subdivideTarget.unitId);
        const ev = unit?.evals.find((item) => item.id === subdivideTarget.evalId);
        if (ev) {
          updateSubdividePreview(ev.weight, count, nameInput?.value.trim() || 'Control');
        }
        return;
      }

      // Clic en confirmar subdivisión
      if (e.target.id === 'confirm-subdivide-btn' || e.target.closest('#confirm-subdivide-btn')) {
        confirmSubdivideModal();
        return;
      }

      // Clic en el fondo oscuro para cerrar el modal
      if (e.target.id === 'subdivide-modal') {
        closeSubdivideModal();
        return;
      }

      const navEl = e.target.closest('[data-nav]');
      if (navEl) {
        navigateTo(navEl.dataset.nav, null);
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const courseId = btn.dataset.courseId;
      const course = state.courses.find((c) => c.id === courseId);

      switch (action) {
        case 'open-course-grades':
          navigateTo('promedios', courseId);
          break;

        case 'open-course-attendance':
          navigateTo('asistencias', courseId);
          break;

        case 'back-to-promedios':
          navigateTo('promedios', null);
          break;

        case 'back-to-asistencias':
          navigateTo('asistencias', null);
          break;

        case 'normalize-unit-weights': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          if (!unit || unit.evals.length === 0) return;
          const sum = unit.evals.reduce((acc, ev) => acc + (parseFloat(ev.weight) || 0), 0);
          if (sum > 0) {
            let running = 0;
            unit.evals.forEach((ev, idx) => {
              if (idx === unit.evals.length - 1) {
                ev.weight = Math.max(0, Math.round((100 - running) * 10) / 10);
              } else {
                const w = Math.round(((parseFloat(ev.weight) || 0) / sum) * 1000) / 10;
                ev.weight = w;
                running += w;
              }
            });
          } else {
            const eq = Math.round((100 / unit.evals.length) * 10) / 10;
            unit.evals.forEach((ev) => (ev.weight = eq));
          }
          saveState();
          renderAll();
          break;
        }

        case 'new-course': {
          const name = prompt('Nombre del nuevo ramo:', 'Nuevo Ramo');
          if (!name) return;
          const created = {
            id: uid(),
            name: name.trim(),
            passMark: 3.95,
            units: [
              {
                id: uid(),
                name: 'Evaluaciones del Ramo',
                weight: 100,
                exigible: true,
                evals: [
                  { id: uid(), name: 'Evaluación 1', date: '', weight: 35, grade: null },
                  { id: uid(), name: 'Evaluación 2', date: '', weight: 35, grade: null },
                  { id: uid(), name: 'Evaluación 3', date: '', weight: 30, grade: null }
                ]
              }
            ],
            acumOpcional: { enabled: false, weight: 30, grade: null, date: '' },
            attendance: { enabled: false, minPct: 80, attended: 0, held: 0, totalEstimated: null }
          };
          state.courses.unshift(created);
          saveState();
          navigateTo('promedios', created.id);
          break;
        }

        case 'toggle-delete-promedios':
          isDeleteModePromedios = !isDeleteModePromedios;
          renderAll();
          break;

        case 'toggle-delete-asistencias':
          isDeleteModeAsistencias = !isDeleteModeAsistencias;
          renderAll();
          break;

        case 'delete-course':
          if (course && confirm(`¿Eliminar el ramo "${formatDisplayCourseName(course.name)}" definitivamente?`)) {
            state.courses = state.courses.filter((c) => c.id !== courseId);
            saveState();
            if (selectedCourseId === courseId) {
              navigateTo('promedios', null);
            } else {
              renderAll();
            }
          }
          break;

        case 'remove-attendance-from-list':
          if (course && confirm(`¿Quitar el ramo "${formatDisplayCourseName(course.name)}" de Control de Asistencias?`)) {
            course.attendance = course.attendance || {};
            course.attendance.enabled = false;
            saveState();
            renderAll();
          }
          break;

        case 'remove-attendance-only':
          if (course && confirm(`¿Quitar el ramo "${formatDisplayCourseName(course.name)}" de Control de Asistencias?`)) {
            course.attendance = course.attendance || {};
            course.attendance.enabled = false;
            saveState();
            navigateTo('asistencias', null);
          }
          break;

        case 'add-eval': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          if (!unit) return;
          const used = unit.evals.reduce((acc, ev) => acc + (parseFloat(ev.weight) || 0), 0);
          const rem = used < 100 ? Math.max(5, Math.round((100 - used) * 10) / 10) : 20;
          unit.evals.push({
            id: uid(),
            name: `Evaluación ${unit.evals.length + 1}`,
            date: '',
            weight: rem,
            grade: null
          });
          saveState();
          renderAll();
          break;
        }

        case 'delete-eval': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          if (!unit || unit.evals.length <= 1) return;
          const ev = unit.evals.find((e) => e.id === btn.dataset.evalId);
          if (confirm(`¿Eliminar la evaluación "${ev?.name || 'Evaluación'}"?`)) {
            unit.evals = unit.evals.filter((e) => e.id !== btn.dataset.evalId);
            saveState();
            renderAll();
          }
          break;
        }

        case 'open-subdivide-modal':
          openSubdivideModal(btn.dataset.courseId, btn.dataset.unitId, btn.dataset.evalId);
          break;

        case 'close-subdivide-modal':
          closeSubdivideModal();
          break;

        case 'unsubdivide-eval': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          const ev = unit?.evals.find((e) => e.id === btn.dataset.evalId);
          if (!ev || !ev.subEvals) return;
          if (confirm('¿Quitar la subdivisión y volver a una sola nota general para esta evaluación?')) {
            const graded = ev.subEvals.map((s) => normalizeGrade(s.grade)).filter((g) => g !== null);
            if (graded.length > 0) {
              const avg = graded.reduce((a, b) => a + b, 0) / graded.length;
              ev.grade = Math.round(avg * 100) / 100;
            } else {
              ev.grade = null;
            }
            delete ev.subEvals;
            saveState();
            renderAll();
          }
          break;
        }

        case 'add-subeval': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          const ev = unit?.evals.find((e) => e.id === btn.dataset.evalId);
          if (!ev) return;
          if (!Array.isArray(ev.subEvals)) ev.subEvals = [];
          let baseName = ev.name.replace(/,.*$/, '').trim();
          if (baseName.includes('·')) baseName = baseName.split('·')[0].trim();
          if (baseName.length > 20) baseName = 'Control';
          if (!baseName) baseName = 'Control';
          ev.subEvals.push({
            id: uid(),
            name: `${baseName} ${ev.subEvals.length + 1}`,
            grade: null
          });
          saveState();
          renderAll();
          break;
        }

        case 'delete-subeval': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          const ev = unit?.evals.find((e) => e.id === btn.dataset.evalId);
          if (!ev || !ev.subEvals) return;
          const sub = ev.subEvals.find((s) => s.id === btn.dataset.subId);
          if (sub && sub.grade !== null) {
            if (!confirm(`¿Eliminar la sub-nota "${sub.name}" que ya tiene nota ${sub.grade}?`)) {
              return;
            }
          }
          ev.subEvals = ev.subEvals.filter((s) => s.id !== btn.dataset.subId);
          if (ev.subEvals.length === 0) {
            delete ev.subEvals;
          }
          saveState();
          renderAll();
          break;
        }

        case 'add-unit': {
          if (!course) return;
          const n = course.units.length + 1;
          const newWeight = Math.round(100 / n);
          course.units.forEach((u) => (u.weight = newWeight));
          course.units.push({
            id: uid(),
            name: `Unidad ${n}`,
            weight: 100 - newWeight * (n - 1),
            exigible: true,
            evals: [
              { id: uid(), name: 'Evaluación 1', date: '', weight: 50, grade: null },
              { id: uid(), name: 'Evaluación 2', date: '', weight: 50, grade: null }
            ]
          });
          saveState();
          renderAll();
          break;
        }

        case 'delete-unit': {
          const unit = course?.units.find((u) => u.id === btn.dataset.unitId);
          if (!course || course.units.length <= 1 || !unit) return;
          if (confirm(`¿Eliminar la unidad "${unit.name}" y todas sus evaluaciones?`)) {
            course.units = course.units.filter((u) => u.id !== btn.dataset.unitId);
            if (course.units.length === 1) course.units[0].weight = 100;
            saveState();
            renderAll();
          }
          break;
        }

        case 'toggle-acum':
          if (!course) return;
          course.acumOpcional = course.acumOpcional || { enabled: false, weight: 30, grade: null };
          course.acumOpcional.enabled = !course.acumOpcional.enabled;
          saveState();
          renderAll();
          break;

        case 'toggle-attendance':
          if (!course) return;
          course.attendance = course.attendance || {
            enabled: false,
            minPct: 80,
            attended: 0,
            held: 0,
            totalEstimated: null
          };
          course.attendance.enabled = !course.attendance.enabled;
          saveState();
          renderAll();
          break;

        case 'toggle-passmark':
          if (!course) return;
          course.passMark = course.passMark === 4.0 ? 3.95 : 4.0;
          saveState();
          renderAll();
          break;

        case 'att-present':
          if (!course) return;
          course.attendance.attended += 1;
          course.attendance.held += 1;
          saveState();
          refreshCourseComputedUI(course.id);
          break;

        case 'att-absent':
          if (!course) return;
          course.attendance.held += 1;
          saveState();
          refreshCourseComputedUI(course.id);
          break;

        case 'apply-selected-attendance':
        case 'apply-detected-attendance': {
          const selectEl = btn.dataset.selectId ? document.getElementById(btn.dataset.selectId) : null;
          const courseId = selectEl ? selectEl.value : btn.dataset.courseId;
          const targetCourse = state.courses.find((c) => c.id === courseId);
          if (!targetCourse) return;
          const att = parseInt(btn.dataset.att, 10);
          const held = parseInt(btn.dataset.held, 10);
          const min = parseInt(btn.dataset.min, 10);

          targetCourse.attendance = targetCourse.attendance || {
            enabled: true,
            minPct: 80,
            attended: 0,
            held: 0,
            totalEstimated: null
          };
          targetCourse.attendance.enabled = true;
          if (!isNaN(att)) targetCourse.attendance.attended = att;
          if (!isNaN(held)) targetCourse.attendance.held = held;
          if (!isNaN(min) && min >= 50 && min <= 100) targetCourse.attendance.minPct = min;

          saveState();
          renderAll();
          alert(`¡Asistencia de "${formatDisplayCourseName(targetCourse.name)}" actualizada con éxito (${targetCourse.attendance.attended}/${targetCourse.attendance.held} clases)!`);
          break;
        }

        case 'paste-attendance-text': {
          try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
              const detected = extractAttendanceData(text, null);
              const statusEl = document.getElementById('att-ocr-status');
              const previewEl = document.getElementById('att-ocr-preview');
              if (detected.length === 0) {
                alert('No se detectaron datos claros de asistencia en el portapapeles.');
              } else {
                if (statusEl) {
                  statusEl.hidden = false;
                  statusEl.style.display = 'block';
                  statusEl.textContent = `Texto analizado: se detectó asistencia para ${detected.length} ramo(s):`;
                }
                if (previewEl) {
                  previewEl.hidden = false;
                  previewEl.style.display = 'block';
                  previewEl.innerHTML = `
                    <div style="font-weight:600; color:var(--red); font-size:0.86rem; margin-bottom:0.6rem;">
                      Asistencia detectada del texto:
                    </div>
                    <div style="display:flex; flex-direction:column; gap:0.65rem; width:100%; max-width:100%;">
                      ${detected
                        .map(
                          (d, idx) => `
                          <div class="att-result-card">
                            <div class="att-result-header">
                              <div style="margin-bottom:0.25rem;">
                                ${d.courseCode ? `<strong style="color:var(--red);">${escapeHtml(d.courseCode)}</strong> · ` : ''}
                                <strong>${escapeHtml(formatDisplayCourseName(d.course.name))}</strong>: <strong>${d.attended}</strong> asistidas de <strong>${d.held}</strong> realizadas · <strong>${d.pct}%</strong>
                                <span style="color:var(--text-muted); font-size:0.72rem;">(Mín ${d.minPct}%)</span>
                              </div>
                            </div>
                            <div class="att-result-assign-box">
                              <label class="att-result-label">Asignar al ramo:</label>
                              <div class="att-result-actions">
                                <select id="att-paste-select-${idx}" class="att-result-select">
                                  ${state.courses.map((c) => `<option value="${c.id}" ${c.id === d.course.id ? 'selected' : ''}>${escapeHtml(formatDisplayCourseName(c.name))}</option>`).join('')}
                                </select>
                                <button type="button" class="btn btn-sm btn-red att-result-btn" data-action="apply-selected-attendance" data-select-id="att-paste-select-${idx}" data-att="${d.attended}" data-held="${d.held}" data-min="${d.minPct}">Aplicar Asistencia</button>
                              </div>
                            </div>
                          </div>
                        `
                        )
                        .join('')}
                    </div>
                  `;
                }
              }
            } else {
              alert('El portapapeles está vacío.');
            }
          } catch {
            alert('No se pudo acceder al portapapeles.');
          }
          break;
        }

        case 'paste-clipboard': {
          try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
              const ta = document.getElementById('import-textarea');
              if (ta) ta.value = text;
              updateImportPreview(text);
            } else {
              alert('El portapapeles está vacío. Toca el cuadro de texto y selecciona "Pegar".');
            }
          } catch {
            alert('Toca dentro del cuadro de texto y selecciona "Pegar".');
          }
          break;
        }

        case 'load-sample-1': {
          const sample = `MODULO I DE INTEGRACION DE COMPETENCIAS PSICOLOGICAS: INVESTIGACION
Tipo\tCalidad\tFecha de Prueba\tPorcentaje\tProrroga\tNota
Informe de investigación\tObligatoria\t11/12/2026\t25
Laboratorio\tObligatoria\t02/10/2026\t10\t\t6.5\t0.650
Laboratorio\tObligatoria\t23/10/2026\t30
Presentación oral\tObligatoria\t04/12/2026\t35`;
          const ta = document.getElementById('import-textarea');
          if (ta) ta.value = sample;
          updateImportPreview(sample);
          break;
        }

        case 'load-sample-2': {
          const sample = `FUNDAMENTOS DE PSICOTERAPIA I
Area\tEvaluación\tTipo\tCalidad\tFecha de Prueba\tPorcentaje\tProrroga\tNota
PSICOTERAPIA COGNITIVO CONDUCTUAL\tEXIGIBLE\t50
Evaluación 1\tPrueba escrita\tObligatoria\t10/12/2026\t40
Evaluación 2\tInforme de caso\tObligatoria\t03/12/2026\t30
Evaluación 3\tRole playing\tObligatoria\t04/12/2026\t20
Evaluación 4\tSimulación de situación práctica\tObligatoria\t26/11/2026\t10
Evaluación 5\tExamen escrito\tAcum.Opcional\t25/11/2026\t30
PSICOTERAPIA PSICOANALÍTICA\tEXIGIBLE\t50
Evaluación 1\tPrueba escrita\tObligatoria\t29/10/2026\t40
Evaluación 2\tInforme de caso\tObligatoria\t30/10/2026\t30
Evaluación 3\tRole playing\tObligatoria\t30/10/2026\t20
Evaluación 4\tSimulación de situación práctica\tObligatoria\t15/10/2026\t10
Evaluación 5\tExamen escrito\tAcum.Opcional\t15/12/2026\t30
Asistencia\tEXIGIBLE\tRequisito de aprobación
Evaluación 1\tAsistencia\tObligatoria\t01/01/1880\t80% mínimo\t%`;
          const ta = document.getElementById('import-textarea');
          if (ta) ta.value = sample;
          updateImportPreview(sample);
          break;
        }

        case 'export-data': {
          const dataStr = JSON.stringify(state, null, 2);
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `notas-utalca-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showCloudBanner('Respaldo descargado.', 'ok', 2000);
          break;
        }

        case 'logout': {
          if (confirm('¿Cerrar sesión en este dispositivo?')) {
            await window.NotasAuth.logout();
          }
          break;
        }

        case 'delete-all-courses': {
          if (confirm('¿Borrar todos tus ramos? Esta acción no se puede deshacer.')) {
            state = { courses: [] };
            saveState();
            renderAll();
            showCloudBanner('Ramos eliminados.', 'ok', 2000);
          }
          break;
        }

        case 'reload-cloud': {
          if (!confirm('Se descartarán los cambios locales que no se hayan guardado en la nube. ¿Continuar?')) {
            break;
          }
          try {
            const remote = await window.NotasCloud.loadState(currentUser.id);
            if (remote && remote.state && Array.isArray(remote.state.courses)) {
              state = { courses: normalizeCourses(remote.state.courses) };
              stateVersion = Number(remote.version) || 0;
              remoteDirty = false;
              writeLocalCache();
              renderAll();
              showCloudBanner('Datos recargados desde la nube.', 'ok', 2500);
            } else {
              showCloudBanner('La nube no tiene datos todavía.', 'warn', 3000);
            }
          } catch (error) {
            showCloudBanner('No se pudo leer la nube. Revisa tu conexión.', 'warn', 4000);
          }
          break;
        }

        case 'reset-demo':
          if (confirm('¿Cargar los ramos de ejemplo? Se reemplazarán los ramos actuales.')) {
            state = { courses: getDefaultCourses() };
            saveState();
            navigateTo('home', null);
          }
          break;
      }
    });

    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            if (currentSection !== 'agregar') navigateTo('agregar', null);
            setTimeout(() => runOcrOnImageFile(file), 50);
            return;
          }
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSubdivideModal();
    });

    window.addEventListener('pagehide', () => {
      saveState(true);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveState(true);
    });
  }

  async function boot() {
    if (!window.NotasAuth || !window.NotasCloud) {
      window.alert('No se pudieron cargar los módulos de cuentas. Revisa auth.js y cloud.js.');
      return;
    }

    const session = await window.NotasAuth.init();
    if (!session) return;

    currentUser = session.user;
    await loadState();
    renderAll();
    setupEvents();

    if (window.NotasCloud.getMode() === 'demo') {
      showCloudBanner(
        'Modo demo local: las cuentas y los ramos se guardan solo en este navegador.',
        'warn',
        6000
      );
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeGrade,
    computeUnitStats,
    computeCourseStats,
    computeAttendanceStats,
    UtalcaParser,
    getDefaultCourses,
    findBestMatchingCourse,
    extractAttendanceData
  };
}
