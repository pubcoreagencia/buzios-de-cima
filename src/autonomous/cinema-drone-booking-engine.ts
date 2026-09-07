import { BookingOrchestrator } from './booking-orchestrator';
import { architectEngine } from './architectEngine';

export type DronePackageTier = 'silver' | 'gold' | 'platinum';

export interface DronePackage {
  id: string;
  tier: DronePackageTier;
  name: string;
  description: string;
  durationMinutes: number;
  resolution: '4K' | '6K';
  includesRawFootage: boolean;
  includesColorGrading: boolean;
  maxCrewSize: number;
  basePriceBRL: number;
  weatherDependency: 'high' | 'medium' | 'low';
}

export interface DroneBookingRequest {
  packageId: string;
  date: string;
  timeWindow: { start: string; end: string };
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  crewSize: number;
  customLocation?: string;
  addOns?: Array<'priority-editing' | 'social-media-cut' | 'drone-insurance'>;
}

export interface DroneBookingResult {
  bookingId: string;
  status: 'confirmed' | 'pending-weather' | 'rejected';
  package: DronePackage;
  totalPriceBRL: number;
  weatherAdvisory?: string;
  orchestratorRef: string;
  scheduledAt: string;
}

const DRONE_PACKAGES: Record<string, DronePackage> = {
  'drone-silver': {
    id: 'drone-silver',
    tier: 'silver',
    name: 'Búzios Vista Silver',
    description: 'Voo panorâmico 4K dos principais mirantes do empreendimento Búzios de Cima.',
    durationMinutes: 60,
    resolution: '4K',
    includesRawFootage: false,
    includesColorGrading: true,
    maxCrewSize: 2,
    basePriceBRL: 1800,
    weatherDependency: 'high',
  },
  'drone-gold': {
    id: 'drone-gold',
    tier: 'gold',
    name: 'Búzios Vista Gold',
    description: 'Captação cinematográfica 4K com edição narrativa e trilha licenciada.',
    durationMinutes: 120,
    resolution: '4K',
    includesRawFootage: true,
    includesColorGrading: true,
    maxCrewSize: 4,
    basePriceBRL: 3200,
    weatherDependency: 'medium',
  },
  'drone-platinum': {
    id: 'drone-platinum',
    tier: 'platinum',
    name: 'Búzios Vista Platinum',
    description: 'Produção completa 6K/4K com roteiro, direção, drone FPV e entrega em até 72h.',
    durationMinutes: 240,
    resolution: '6K',
    includesRawFootage: true,
    includesColorGrading: true,
    maxCrewSize: 8,
    basePriceBRL: 7800,
    weatherDependency: 'low',
  },
};

const ADDON_PRICE_BRL: Record<string, number> = {
  'priority-editing': 650,
  'social-media-cut': 450,
  'drone-insurance': 380,
};

const TIME_WINDOWS = ['06:00-08:00', '08:00-10:00', '16:00-18:00', '17:00-19:00'] as const;

export class CinemaDroneBookingEngine {
  private orchestrator: BookingOrchestrator;
  private bookedSlots = new Map<string, Set<string>>();

  constructor(orchestrator?: BookingOrchestrator) {
    this.orchestrator = orchestrator ?? new BookingOrchestrator();
  }

  listPackages(): DronePackage[] {
    return Object.values(DRONE_PACKAGES);
  }

  getPackage(id: string): DronePackage | undefined {
    return DRONE_PACKAGES[id];
  }

  listAvailableTimeWindows(date: string): string[] {
    const day = this.bookedSlots.get(date) ?? new Set<string>();
    return TIME_WINDOWS.filter((w) => !day.has(w));
  }

  calculatePrice(pkg: DronePackage, addOns: DroneBookingRequest['addOns'] = []): number {
    const addonTotal = addOns.reduce((sum, a) => sum + (ADDON_PRICE_BRL[a] ?? 0), 0);
    const tierMultiplier = pkg.tier === 'platinum' ? 1.15 : pkg.tier === 'gold' ? 1.08 : 1.0;
    return Math.round((pkg.basePriceBRL + addonTotal) * tierMultiplier * 100) / 100;
  }

  validateRequest(req: DroneBookingRequest): { ok: boolean; reason?: string } {
    const pkg = this.getPackage(req.packageId);
    if (!pkg) return { ok: false, reason: 'Pacote inexistente.' };
    if (req.crewSize < 1 || req.crewSize > pkg.maxCrewSize) {
      return { ok: false, reason: `Crew size deve estar entre 1 e ${pkg.maxCrewSize}.` };
    }
    if (!this.listAvailableTimeWindows(req.date).includes(req.timeWindow.start + '-' + req.timeWindow.end)) {
      return { ok: false, reason: 'Slot indisponível para a data selecionada.' };
    }
    const dateObj = new Date(req.date);
    if (isNaN(dateObj.getTime()) || dateObj.getTime() < Date.now()) {
      return { ok: false, reason: 'Data inválida ou no passado.' };
    }
    if (!req.guestEmail.includes('@')) {
      return { ok: false, reason: 'Email inválido.' };
    }
    return { ok: true };
  }

  async bookDroneExperience(req: DroneBookingRequest): Promise<DroneBookingResult> {
    const validation = this.validateRequest(req);
    if (!validation.ok) {
      throw new Error(`Drone booking rejected -> ${validation.reason}`);
    }
    const pkg = this.getPackage(req.packageId)!;
    const slotKey = `${req.timeWindow.start}-${req.timeWindow.end}`;
    const daySet = this.bookedSlots.get(req.date) ?? new Set<string>();
    daySet.add(slotKey);
    this.bookedSlots.set(req.date, daySet);

    const totalPrice = this.calculatePrice(pkg, req.addOns);
    const status: DroneBookingResult['status'] =
      pkg.weatherDependency === 'high' ? 'pending-weather' : 'confirmed';

    const weatherAdvisory =
      pkg.weatherDependency === 'high'
        ? 'Voo sujeito a condições climáticas (vento < 25 km/h, sem chuva).'
        : pkg.weatherDependency === 'medium'
          ? 'Voo com tolerância moderada a ventos.'
          : 'Voo com janela climática estendida.';

    const orchestratorRef = await this.orchestrator.dispatch({
      type: 'cinema-drone',
      guest: { name: req.guestName, email: req.guestEmail, phone: req.guestPhone },
      totalPriceBRL: totalPrice,
      scheduledAt: `${req.date}T${req.timeWindow.start}:00.000Z`,
      metadata: {
        packageId: pkg.id,
        crewSize: req.crewSize,
        customLocation: req.customLocation,
        addOns: req.addOns ?? [],
        resolution: pkg.resolution,
      },
    });

    architectEngine.logActivity('cinema-drone-booking', {
      package: pkg.id,
      guest: req.guestEmail,
      totalPriceBRL: totalPrice,
      status,
    });

    return {
      bookingId: `DRN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status,
      package: pkg,
      totalPriceBRL: totalPrice,
      weatherAdvisory,
      orchestratorRef,
      scheduledAt: `${req.date}T${req.timeWindow.start}:00.000Z`,
    };
  }

  getOccupancyForDate(date: string): { booked: string[]; available: string[] } {
    const booked = Array.from(this.bookedSlots.get(date) ?? new Set<string>());
    const available = TIME_WINDOWS.filter((w) => !booked.includes(w));
    return { booked, available };
  }
}

export const cinemaDroneBookingEngine = new CinemaDroneBookingEngine();
