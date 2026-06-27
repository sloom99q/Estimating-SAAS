/**
 * MEP-3 — seed the MepRule table per discipline.
 *
 * HVAC ruleset is the §4 worked example from docs/MEP_RULE_ENGINE.md
 * verbatim. Elec / Plumb / ELV ship as PLACEHOLDER rules at confidence
 * 0.4 so the auditor surfaces them in the SPA review queue until the
 * estimator confirms with real engineer-takeoff data.
 *
 * Idempotent — looks up by (org, discipline, name) and upserts.
 *
 *   bun apps/api/scripts/seed-mep-rules.ts                     # dry-run
 *   bun apps/api/scripts/seed-mep-rules.ts --apply             # commit
 *   bun apps/api/scripts/seed-mep-rules.ts --apply --org <id>  # scope
 */
import { prisma } from '../src/db'

const apply = process.argv.includes('--apply')
const orgIdx = process.argv.indexOf('--org')
const onlyOrg = orgIdx >= 0 ? process.argv[orgIdx + 1] : null

interface RuleSeed {
  discipline: 'HVAC' | 'ELECTRICAL' | 'PLUMBING' | 'ELV'
  name: string
  driver: string
  driverFilter?: string
  factor: number
  factorSource: string
  factorConfidence: number
  outputUnit: string
  rate: number
  rateSource: string
  rateConfidence: number
  takeoffCategory: 'MEP_HVAC' | 'MEP_ELEC' | 'MEP_PLUMB' | 'MEP_ELV'
  sortOrder: number
  notes?: string
}

// HVAC — engineer-derived norms + mid-market UAE rates.
const HVAC_RULES: RuleSeed[] = [
  {
    discipline: 'HVAC',
    name: 'Split AC units (cooling load)',
    driver: 'AREA_FT2',
    factor: 1 / 135,
    factorSource: 'industry norm: 135 ft²/TR (engineer-cited, ASHRAE residential)',
    factorConfidence: 0.85,
    outputUnit: 'TR',
    rate: 2800,
    rateSource: 'mid-market UAE 2026 estimate — installed split unit incl. F-gas, bracket, isolator (CONFIRM)',
    rateConfidence: 0.5,
    takeoffCategory: 'MEP_HVAC',
    sortOrder: 10,
    notes: 'For villas > 50 TR replace with chiller assembly; not in v1 schema.',
  },
  {
    discipline: 'HVAC',
    name: 'HVAC ducting (insulated GI)',
    driver: 'AREA_M2',
    factor: 1.518,
    factorSource: 'engineer takeoff Lami villa: 540 m² duct / 356 m² floor',
    factorConfidence: 0.8,
    outputUnit: 'm²',
    rate: 220,
    rateSource: 'mid-market UAE — supply + return + insulation, installed (CONFIRM)',
    rateConfidence: 0.5,
    takeoffCategory: 'MEP_HVAC',
    sortOrder: 20,
  },
  {
    discipline: 'HVAC',
    name: 'Diffusers + grilles',
    driver: 'AREA_FT2',
    factor: 0.0085,
    factorSource: 'engineer takeoff: 33 diffusers / 3,834 ft² ≈ 0.0086',
    factorConfidence: 0.8,
    outputUnit: 'No',
    rate: 180,
    rateSource: 'mid-market UAE installed (CONFIRM)',
    rateConfidence: 0.55,
    takeoffCategory: 'MEP_HVAC',
    sortOrder: 30,
  },
  {
    discipline: 'HVAC',
    name: 'Thermostats',
    driver: 'BEDROOM_COUNT',
    factor: 1,
    factorSource: '1 thermostat per bedroom (master rooms have own; small rooms share — UAE residential norm)',
    factorConfidence: 0.75,
    outputUnit: 'No',
    rate: 350,
    rateSource: 'mid-market UAE installed (CONFIRM)',
    rateConfidence: 0.55,
    takeoffCategory: 'MEP_HVAC',
    sortOrder: 40,
  },
  {
    discipline: 'HVAC',
    name: 'Refrigerant piping (copper, insulated)',
    driver: 'AREA_FT2',
    factor: (1 / 135) * 4, // pre-multiplied through cooling-load chain per design doc §4 rule chaining
    factorSource: 'derived: TR/ft² × 4 m piping/TR (typical condenser-to-FCU runs, UAE villa)',
    factorConfidence: 0.75,
    outputUnit: 'm',
    rate: 95,
    rateSource: 'mid-market UAE installed (CONFIRM)',
    rateConfidence: 0.55,
    takeoffCategory: 'MEP_HVAC',
    sortOrder: 50,
  },
  {
    discipline: 'HVAC',
    name: 'Condenser concrete pads',
    driver: 'FIXED',
    factor: 1,
    factorSource: 'one-time per villa',
    factorConfidence: 0.85,
    outputUnit: 'LS',
    rate: 800,
    rateSource: 'mid-market UAE (CONFIRM)',
    rateConfidence: 0.55,
    takeoffCategory: 'MEP_HVAC',
    sortOrder: 60,
  },
]

// ELECTRICAL — placeholder norms; confidence 0.4 ⇒ flagged for confirm.
const ELEC_RULES: RuleSeed[] = [
  {
    discipline: 'ELECTRICAL',
    name: 'Main distribution panel (MDB)',
    driver: 'FIXED',
    factor: 1,
    factorSource: 'one-per-villa norm',
    factorConfidence: 0.85,
    outputUnit: 'LS',
    rate: 6500,
    rateSource: 'PLACEHOLDER — confirm with electrical contractor quote',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELEC',
    sortOrder: 10,
  },
  {
    discipline: 'ELECTRICAL',
    name: 'Wall sockets (13A switched + cable to MDB)',
    driver: 'ROOM_COUNT',
    factor: 6,
    factorSource: 'PLACEHOLDER — assumes ~6 sockets per habitable room (bedroom heavy)',
    factorConfidence: 0.4,
    outputUnit: 'pt',
    rate: 95,
    rateSource: 'PLACEHOLDER — typical UAE socket point installed',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELEC',
    sortOrder: 20,
  },
  {
    discipline: 'ELECTRICAL',
    name: 'Light points (downlights + drivers)',
    driver: 'AREA_M2',
    factor: 0.4,
    factorSource: 'PLACEHOLDER — ~1 downlight per 2.5 m² floor',
    factorConfidence: 0.4,
    outputUnit: 'pt',
    rate: 140,
    rateSource: 'PLACEHOLDER — UAE LED downlight installed',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELEC',
    sortOrder: 30,
  },
  {
    discipline: 'ELECTRICAL',
    name: 'Light switches (3-gang + cable)',
    driver: 'ROOM_COUNT',
    factor: 1.5,
    factorSource: 'PLACEHOLDER — main switch per room + secondary in larger rooms',
    factorConfidence: 0.4,
    outputUnit: 'pt',
    rate: 110,
    rateSource: 'PLACEHOLDER — UAE switch point installed',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELEC',
    sortOrder: 40,
  },
  {
    discipline: 'ELECTRICAL',
    name: 'AC isolators (1-per-condenser)',
    driver: 'BEDROOM_COUNT',
    factor: 1,
    factorSource: 'PLACEHOLDER — 1 isolator per AC zone (rough = bedroom count)',
    factorConfidence: 0.4,
    outputUnit: 'No',
    rate: 220,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELEC',
    sortOrder: 50,
  },
]

// PLUMBING — placeholder norms; confidence 0.4.
const PLUMB_RULES: RuleSeed[] = [
  {
    discipline: 'PLUMBING',
    name: 'WC fixture points (suite + cistern + supply + waste)',
    driver: 'BATHROOM_COUNT',
    factor: 1,
    factorSource: 'PLACEHOLDER — 1 WC per bathroom',
    factorConfidence: 0.7,
    outputUnit: 'pt',
    rate: 1500,
    rateSource: 'PLACEHOLDER — typical UAE WC fixture point installed (incl. suite)',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_PLUMB',
    sortOrder: 10,
  },
  {
    discipline: 'PLUMBING',
    name: 'Wash basin points',
    driver: 'BATHROOM_COUNT',
    factor: 1,
    factorSource: 'PLACEHOLDER — 1 basin per bathroom (master may have 2 — manual override)',
    factorConfidence: 0.6,
    outputUnit: 'pt',
    rate: 950,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_PLUMB',
    sortOrder: 20,
  },
  {
    discipline: 'PLUMBING',
    name: 'Shower points',
    driver: 'BATHROOM_COUNT',
    factor: 1,
    factorSource: 'PLACEHOLDER — 1 shower per full bath (powder rooms exempt — manual)',
    factorConfidence: 0.55,
    outputUnit: 'pt',
    rate: 1200,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_PLUMB',
    sortOrder: 30,
  },
  {
    discipline: 'PLUMBING',
    name: 'Kitchen sink points (hot + cold)',
    driver: 'KITCHEN_COUNT',
    factor: 1,
    factorSource: 'PLACEHOLDER — 1 sink per kitchen',
    factorConfidence: 0.85,
    outputUnit: 'pt',
    rate: 850,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_PLUMB',
    sortOrder: 40,
  },
  {
    discipline: 'PLUMBING',
    name: 'Water heater (per villa)',
    driver: 'FIXED',
    factor: 1,
    factorSource: 'PLACEHOLDER — assumes single central heater; multi-heater configs override',
    factorConfidence: 0.5,
    outputUnit: 'No',
    rate: 1800,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_PLUMB',
    sortOrder: 50,
  },
  {
    discipline: 'PLUMBING',
    name: 'PEX/PPR pipework + waste pipe (run length proxy)',
    driver: 'AREA_M2',
    factor: 0.9,
    factorSource: 'PLACEHOLDER — m of pipe per m² floor (rough proxy until per-fixture chain in v2)',
    factorConfidence: 0.4,
    outputUnit: 'm',
    rate: 75,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_PLUMB',
    sortOrder: 60,
  },
]

// ELV — placeholder norms; confidence 0.4.
const ELV_RULES: RuleSeed[] = [
  {
    discipline: 'ELV',
    name: 'Data + voice points (Cat6)',
    driver: 'ROOM_COUNT',
    factor: 1,
    factorSource: 'PLACEHOLDER — 1 point per habitable room',
    factorConfidence: 0.4,
    outputUnit: 'pt',
    rate: 280,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELV',
    sortOrder: 10,
  },
  {
    discipline: 'ELV',
    name: 'CCTV cameras (perimeter)',
    driver: 'FIXED',
    factor: 6,
    factorSource: 'PLACEHOLDER — 6 cameras typical UAE villa (corners + entry)',
    factorConfidence: 0.4,
    outputUnit: 'No',
    rate: 850,
    rateSource: 'PLACEHOLDER — installed incl. cable home-run',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELV',
    sortOrder: 20,
  },
  {
    discipline: 'ELV',
    name: 'NVR + storage (per villa)',
    driver: 'FIXED',
    factor: 1,
    factorSource: 'one-per-villa norm',
    factorConfidence: 0.85,
    outputUnit: 'LS',
    rate: 2500,
    rateSource: 'PLACEHOLDER — mid-market 8-ch NVR + 2TB',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELV',
    sortOrder: 30,
  },
  {
    discipline: 'ELV',
    name: 'Door video intercom',
    driver: 'FIXED',
    factor: 1,
    factorSource: 'one-per-entry norm',
    factorConfidence: 0.8,
    outputUnit: 'No',
    rate: 1400,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELV',
    sortOrder: 40,
  },
  {
    discipline: 'ELV',
    name: 'Smoke detectors',
    driver: 'ROOM_COUNT',
    factor: 0.6,
    factorSource: 'PLACEHOLDER — 1 per ~2 rooms (corridor + bedroom focus)',
    factorConfidence: 0.4,
    outputUnit: 'No',
    rate: 220,
    rateSource: 'PLACEHOLDER',
    rateConfidence: 0.4,
    takeoffCategory: 'MEP_ELV',
    sortOrder: 50,
  },
]

const ALL: RuleSeed[] = [...HVAC_RULES, ...ELEC_RULES, ...PLUMB_RULES, ...ELV_RULES]

console.log(`[seed-mep-rules] mode: ${apply ? 'APPLY' : 'dry-run'}${onlyOrg ? ` org=${onlyOrg}` : ''}`)
console.log(`[seed-mep-rules] ${ALL.length} rules across 4 disciplines`)

const orgs = onlyOrg
  ? await prisma.organization.findMany({ where: { id: onlyOrg, deletedAt: null }, select: { id: true, name: true } })
  : await prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true } })

if (orgs.length === 0) {
  console.error('no matching orgs')
  process.exit(1)
}

let upserts = 0
for (const org of orgs) {
  console.log(`\n[org] ${org.id}  ${org.name}`)
  for (const r of ALL) {
    const existing = await prisma.mepRule.findUnique({
      where: { organizationId_discipline_name: { organizationId: org.id, discipline: r.discipline, name: r.name } },
    })
    if (apply) {
      await prisma.mepRule.upsert({
        where: { organizationId_discipline_name: { organizationId: org.id, discipline: r.discipline, name: r.name } },
        create: {
          organizationId: org.id,
          discipline: r.discipline,
          name: r.name,
          driver: r.driver,
          driverFilter: r.driverFilter ?? null,
          factor: r.factor.toString(),
          factorSource: r.factorSource,
          factorConfidence: r.factorConfidence.toString(),
          outputUnit: r.outputUnit,
          rate: r.rate.toString(),
          rateSource: r.rateSource,
          rateConfidence: r.rateConfidence.toString(),
          takeoffCategory: r.takeoffCategory,
          sortOrder: r.sortOrder,
          notes: r.notes ?? null,
        },
        update: {
          driver: r.driver,
          driverFilter: r.driverFilter ?? null,
          factor: r.factor.toString(),
          factorSource: r.factorSource,
          factorConfidence: r.factorConfidence.toString(),
          outputUnit: r.outputUnit,
          rate: r.rate.toString(),
          rateSource: r.rateSource,
          rateConfidence: r.rateConfidence.toString(),
          takeoffCategory: r.takeoffCategory,
          sortOrder: r.sortOrder,
          notes: r.notes ?? null,
        },
      })
      upserts += 1
    }
    const marker = existing ? '~' : '+'
    const lineConf = Math.min(r.factorConfidence, r.rateConfidence).toFixed(2)
    console.log(
      `  ${marker} [${r.discipline.padEnd(10)}] ${r.name.padEnd(50)}  ${r.driver.padEnd(14)}  f=${r.factor.toFixed(4).padStart(8)}  r=${r.rate.toString().padStart(6)} AED/${r.outputUnit.padEnd(3)}  conf=${lineConf}`,
    )
  }
}

console.log('')
if (apply) console.log(`[seed-mep-rules] upserted ${upserts} rules across ${orgs.length} orgs`)
else console.log(`[seed-mep-rules] dry-run only. Re-run with --apply to commit.`)
process.exit(0)
