import { RealEstateHospitalityTechLeadEngine } from './real-estate-hospitality-tech-leadEngine';
import { CinemaDroneBookingEngine } from './cinema-drone-booking-engine';
import { ArchitectEngine } from './architectEngine';

export type GuestProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  document: string;
  vipTier: 'standard' | 'gold' | 'platinum' | 'founder';
  preferences: {
    checkInWindow: { from: string; to: string };
    partySize: number;
    droneCoverage: boolean;
    cinematicPackage: boolean;
  };
};

export type HospitalityUnit = {
  id: string;
  label: string;
  capacity: number;
  nightlyRateBRL: number;
  amenities: string[];
  droneFriendly: boolean;
};

export type BookingRequest = {
  requestId: string;
  guest: GuestProfile;
  unitId: string;
  arrival: string;
  departure: string;
  addons: {
    cinemaDrone4K: boolean;
    privateChef: boolean;
    yachtTransfer: boolean;
  };
};

export type BookingQuote = {
  requestId: string;
  unitId: string;
  nights: number;
  baseSubtotal: number;
  cinemaDroneFee: number;
  privateChefFee: number;
  yachtTransferFee: number;
  hospitalityTechFee: number;
  totalBRL: number;
  status: 'pending' | 'confirmed' | 'rejected';
  rejectionReason?: string;
  engineeredAt: string;
};

const ADDON_PRICING = {
  cinemaDronePerFlight: 1850,
  privateChefPerNight: 980,
  yachtTransferOneWay: 1450,
};

const HOSPITALITY_TECH_FEE_RATE = 0.04;

export class BookingOrchestrator {
  private static instance: BookingOrchestrator;
  private readonly quotes: Map<string, BookingQuote> = new Map();

  private constructor(
    private readonly hospitalityEngine = RealEstateHospitalityTechLeadEngine.bootstrap(),
    private readonly droneEngine = CinemaDroneBookingEngine.bootstrap(),
    private readonly architect = ArchitectEngine.bootstrap(),
  ) {}

  static bootstrap(): BookingOrchestrator {
    if (!BookingOrchestrator.instance) {
      BookingOrchestrator.instance = new BookingOrchestrator();
    }
    return BookingOrchestrator.instance;
  }

  async orchestrate(request: BookingRequest, unit: HospitalityUnit): Promise<BookingQuote> {
    const nights = this.computeNights(request.arrival, request.departure);
    if (nights <= 0) {
      return this.persist({
        requestId: request.requestId,
        unitId: unit.id,
        nights: 0,
        baseSubtotal: 0,
        cinemaDroneFee: 0,
        privateChefFee: 0,
        yachtTransferFee: 0,
        hospitalityTechFee: 0,
        totalBRL: 0,
        status: 'rejected',
        rejectionReason: 'Janela de dates inválida para a estadia.',
        engineeredAt: new Date().toISOString(),
      });
    }

    const capacityCheck = this.architect.validateCapacity(unit, request.guest.preferences.partySize);
    if (!capacityCheck.ok) {
      return this.persist({
        requestId: request.requestId,
        unitId: unit.id,
        nights,
        baseSubtotal: 0,
        cinemaDroneFee: 0,
        privateChefFee: 0,
        yachtTransferFee: 0,
        hospitalityTechFee: 0,
        totalBRL: 0,
        status: 'rejected',
        rejectionReason: capacityCheck.reason,
        engineeredAt: new Date().toISOString(),
      });
    }

    const baseSubtotal = nights * unit.nightlyRateBRL;
    const cinemaDroneFee = request.addons.cinemaDrone4K
      ? ADDON_PRICING.cinemaDronePerFlight
      : 0;
    const privateChefFee = request.addons.privateChef
      ? nights * ADDON_PRICING.privateChefPerNight
      : 0;
    const yachtTransferFee = request.addons.yachtTransfer
      ? ADDON_PRICING.yachtTransferOneWay * 2
      : 0;

    const preFeeSubtotal = baseSubtotal + cinemaDroneFee + privateChefFee + yachtTransferFee;
    const hospitalityTechFee = Math.round(preFeeSubtotal * HOSPITALITY_TECH_FEE_RATE * 100) / 100;

    const totalBRL = Math.round((preFeeSubtotal + hospitalityTechFee) * 100) / 100;

    const droneBookingId = request.addons.cinemaDrone4K
      ? await this.droneEngine.scheduleCoverage({
          bookingId: request.requestId,
          unitId: unit.id,
          windows: this.droneEngine.defaultWindowsForStay(request.arrival, request.departure),
          tier: request.guest.vipTier,
        })
      : null;

    await this.hospitalityEngine.persistReservation({
      requestId: request.requestId,
      guestId: request.guest.id,
      unitId: unit.id,
      totalBRL,
      droneBookingId,
    });

    return this.persist({
      requestId: request.requestId,
      unitId: unit.id,
      nights,
      baseSubtotal,
      cinemaDroneFee,
      privateChefFee,
      yachtTransferFee,
      hospitalityTechFee,
      totalBRL,
      status: 'confirmed',
      engineeredAt: new Date().toISOString(),
    });
  }

  listQuotes(): BookingQuote[] {
    return Array.from(this.quotes.values());
  }

  getQuote(requestId: string): BookingQuote | undefined {
    return this.quotes.get(requestId);
  }

  private persist(quote: BookingQuote): BookingQuote {
    this.quotes.set(quote.requestId, quote);
    return quote;
  }

  private computeNights(arrival: string, departure: string): number {
    const start = Date.parse(arrival);
    const end = Date.parse(departure);
    if (Number.isNaN(start) || Number.isNaN(end)) return 0;
    return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  }
}

export const bookingOrchestrator = BookingOrchestrator.bootstrap();
