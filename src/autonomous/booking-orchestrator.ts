/**
 * Booking Orchestrator - Setor 7
 * Empreendimento Búzios de Cima & Produção Cinema Drone 4K
 *
 * Coordena reservas de hospedagem boutique + sessões de cinema aéreo 4K
 * em uma única esteira com validação, pricing dinâmico e idempotência.
 */

export type StayTier = 'standard' | 'panoramic' | 'penthouse';
export type DronePackage = 'sunrise-4k' | 'sunset-4k' | 'full-day-cinema';
exnort type Currency = 'BRL' | 'USD' | 'EUR';

interface StayUnit {
  id: string
  tier: StayTier
  basePricePerNight: Record<Currency, number>
  maxGuests: number
  cinematicView: boolean
}

interface DroneServiceConfig {
  package: DronePackage
  basePrice: Record<Currency, number>
  durationHours: number
  resolution: '4K' | '6K' | '8K'
  includesRawFootage: boolean
  droneFleet: string[]
}

export interface BookingRequest {
  guestId: string
  unitId: string
  checkIn: string
  checkOut: string
  guests: number
  currency: Currency
  addons?: {
    dronePackage?: DronePackage
    privateChef?: boolean
    yachtTransfer?: boolean
  }
  idempotencyKey: string
}

export interface PriceBreakdown {
  nights: number
  nightly: number
  subtotalStay: number
  droneTotal: number
  addonsTotal: number
  tourismTax: number
  total: number
  currency: Currency
}

export interface BookingResult {
  bookingId: string
  status: 'CONFIRMED' | 'PENDING' | 'REJECTED'
  pricing: PriceBreakdown
  unit: StayUnit
  droneSession?: { package: DronePackage; scheduledAt: string }
  message: string
  createdAt: string
}

const STAY_UNITS: StayUnit[] = [
  {
    id: 'BZ-S-01',
    tier: 'standard',
    basePricePerNight: { BRL: 1800, USD: 360, EUR: 330 },
    maxGuests: 2,
    cinematicView: false,
  },
  {
    id: 'BZ-P-04',
    tier: 'panoramic',
    basePricePerNight: { BRL: 3200, USD: 640, EUR: 590 },
    maxGuests: 4,
    cinematicView: true,
  },
  {
    id: 'BZ-PH-07',
    tier: 'penthouse',
    basePricePerNight: { BRL: 7800, USD: 1560, EUR: 1440 },
    maxGuests: 6,
    cinematicView: true,
  },
];

const DRONE_PACKAGES: Record<DronePackage, DroneServiceConfig> = {
  'sunrise-4k': {
    package: 'sunrise-4k',
    basePrice: { BRL: 2400, USD: 480, EUR: 440 },
    durationHours: 2,
    resolution: '4K',
    includesRawFootage: true,
    droneFleet: ['DJI Inspire 3', 'DJI Mavic 3 Pro Cine'],
  },
  'sunset-4k': {
    package: 'sunset-4k',
    basePrice: { BRL: 2900, USD: 580, EUR: 535 },
    durationHours: 3,
    resolution: '4K',
    includesRawFootage: true,
    droneFleet: ['DJI Inspire 3', 'DJI Mavic 3 Pro Cine', 'Freefly Alta X'],
  },
  'full-day-cinema': {
    package: 'full-day-cinema',
    basePrice: { BRL: 14500, USD: 2900, EUR: 2680 },
    durationHours: 10,
    resolution: '8K',
    includesRawFootage: true,
    droneFleet: ['DJI Inspire 3', 'Freefly Alta X', 'DJI X9-8K', 'RED Komodo'],
  },
};

const ADDON_PRICES: Record<string, Record<Currency, number>> = {
  privateChef: { BRL: 950, USD: 190, EUR: 175 },
  yachtTransfer: { BRL: 1800, USD: 360, EUR: 330 },
};

const TOURISM_TAX_RATE = 0.05; // 5% taxa de turismo boutique
const idempotencyCache = new Map<string, BookingResult>();

function diffNights(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  return Math.ceil((b - a) / (1000 * 60 * 60 * 24));
}

function generateBookingId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BZ-${ts}-${rnd}`;
}

function validateRequest(req: BookingRequest, unit: StayUnit): string[] {
  const errors: string[] = [];
  const nights = diffNights(req.checkIn, req.checkOut);
  if (nights < 1) errors.push('INVALID_DATE_RANGE');
  if (req.guests < 1) errors.push('INVALID_GUEST_COUNT');
  if (req.guests > unit.maxGuests) errors.push('GUESTS_EXCEED_UNIT_CAPACITY');
  if (!['BRL', 'USD', 'EUR'].includes(req.currency)) errors.push('UNSUPPORTED_CURRENCY');
  if (!req.idempotencyKey || req.idempotencyKey.length < 8) errors.push('INVALID_IDEMPOTENCY_KEY');
  return errors;
}

export class BookingOrchestrator {
  private readonly units: StayUnit[];

  constructor(units: StayUnit[] = STAY_UNITS) {
    this.units = units;
  }

  listUnits(): StayUnit[] {
    return [...this.units];
  }

  listDronePackages(): DroneServiceConfig[] {
    return Object.values(DRONE_PACKAGES);
  }

  /**
   * Cria uma reserva integrada (stay + drone cinema 4K) com idempotência.
   */
  createBooking(req: BookingRequest): BookingResult {
    const cached = idempotencyCache.get(req.idempotencyKey);
    if (cached) return cached;

    const unit = this.units.find((u) => u.id === req.unitId);
    if (!unit) {
      return this.buildRejected('UNIT_NOT_FOUND');
    }

    const errors = validateRequest(req, unit);
    if (errors.length > 0) {
      return this.buildRejected(errors.join(','));
    }

    const nights = diffNights(req.checkIn, req.checkOut);
    const nightly = unit.basePricePerNight[req.currency];
    const subtotalStay = nightly * nights;

    let droneTotal = 0;
    let droneSession: BookingResult['droneSession'];
    if (req.addons?.dronePackage) {
      const pkg = DRONE_PACKAGES[req.addons.dronePackage];
      droneTotal = pkg.basePrice[req.currency];
      // Sessão drone agendada para o 2º dia de stay às 05:30 (sunrise) ou 17:00 (sunset/full)
      const start = new Date(req.checkIn);
      start.setDate(start.getDate() + 1);
      const hour = req.addons.dronePackage === 'sunrise-4k' ? 5 : req.addons.dronePackage === 'sunset-4k' ? 17 : 8;
      start.setHours(hour, 30, 0, 0);
      droneSession = {
        package: req.addons.dronePackage,
        scheduledAt: start.toISOString(),
      };
    }

    let addonsTotal = 0;
    if (req.addons?.privateChef) addonsTotal += ADDON_PRICES.privateChef[req.currency];
    if (req.addons?.yachtTransfer) addonsTotal += ADDON_PRICES.yachtTransfer[req.currency];

    const taxableBase = subtotalStay + droneTotal + addonsTotal;
    const tourismTax = Number((taxableBase * TOURISM_TAX_RATE).toFixed(2));
    const total = Number((taxableBase + tourismTax).toFixed(2));

    const result: BookingResult = {
      bookingId: generateBookingId(),
      status: 'CONFIRMED',
      pricing: {
        nights,
        nightly,
        subtotalStay,
        droneTotal,
        addonsTotal,
        tourismTax,
        total,
        currency: req.currency,
      },
      unit,
      droneSession,
      message: `Reserva confirmada em Búzios de Cima — ${unit.tier.toUpperCase()} por ${nights} noite(s).`,
      createdAt: new Date().toISOString(),
    };

    idempotencyCache.set(req.idempotencyKey, result);
    return result;
  }

  private buildRejected(reason: string): BookingResult {
    return {
      bookingId: '',
      status: 'REJECTED',
      pricing: {
        nights: 0,
        nightly: 0,
        subtotalStay: 0,
        droneTotal: 0,
        addonsTotal: 0,
        tourismTax: 0,
        total: 0,
        currency: 'BRL',
      },
      unit: STAY_UNITS[0],
      message: `Reserva rejeitada: ${reason}`,
      createdAt: new Date().toISOString(),
    };
  }
}

export default BookingOrchestrator;
