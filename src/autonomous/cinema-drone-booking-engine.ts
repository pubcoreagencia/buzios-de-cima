/**
 * Cinema Drone Booking Engine 4K — Búzios de Cima
 * ----------------------------------------------
 * Motor de reservas para produções audiovisuais cinematográficas
 * captadas via drone 4K no empreendimento turístico boutique
 * "Búzios de Cima".
 *
 * Capacidades:
  *  - Reserva de slots cinematográficos (golden hour / blue hour / noturno)
 *  - Cálculo de score de janela climática (vento, chuva, luminosidade)
 *  - Pacotes combinados: hospedagem boutique + produção drone 4K + piloto certificado
 *  - Orquestração de entregáveis (RAW 4K, ProRes 4444, edição 60s, fotos 12MP)
 *  - Integração com booking-orchestrator e real-estate-hospitality-tech-lead
 *
 * @module autonomous/cinema-drone-booking-engine
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types & Domain Models
// ---------------------------------------------------------------------------

export type SlotKind = 'golden_hour' | 'blue_hour' | 'night_sky' | 'midday';
export type DeliverableFormat = 'RAW_4K' | 'PRORES_4444' | 'EDIT_60S' | 'STILLS_12MP';

export interface GeoPoint {
  lat: number;
  lng: number;
  altitudeMeters: number;
}

export interface WeatherWindow {
  startsAt: Date;
  endsAt: Date;
  windKmh: number;
  precipitationMm: number;
  visibilityKm: number;
  cloudCoverPct: number;
}

export interface BookingRequest {
  guestId: string;
  propertyId: string;
  desiredSlot: SlotKind;
  preferredDate: Date;
  guestCount: number;
  formats: DeliverableFormat[];
  notes?: string;
}

export interface BookingConfirmation {
  bookingId: string;
  status: 'confirmed' | 'pending_weather' | 'awaiting_payment';
  scheduledFor: Date;
  weatherScore: number;
  totalBRL: number;
  deliverables: DeliverableFormat[];
  pilotCallsign: string;
}

// ---------------------------------------------------------------------------
// Pricing Matrix (R$)
// ---------------------------------------------------------------------------

const SLOT_BASE_PRICE: Record<SlotKind, number> = {
  golden_hour: 4800,
  blue_hour: 5200,
  night_sky: 6400,
  midday: 3200,
};

const FORMAT_PRICE: Record<DeliverableFormat, number> = {
  RAW_4K: 0,
  PRORES_4444: 1200,
  EDIT_60S: 1800,
  STILLS_12MP: 900,
};

const GUEST_SURCHARGE_PER_EXTRA = 350;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class CinemaDroneBookingEngine extends EventEmitter {
  private readonly bookings = new Map<string, BookingConfirmation>();
  private readonly pilots: string[] = ['FALCÃO-01', 'ARIRANHA-02', 'TUCANO-03'];

  /**
   * Cria uma reserva cinematográfica. Aplica scoring de janela climática
   * simulada e retorna confirmação (ou pending_weather).
   */
  createBooking(req: BookingRequest): BookingConfirmation {
    const weather = this.simulateWeatherWindow(req.preferredDate, req.desiredSlot);
    const score = this.scoreWeather(weather, req.desiredSlot);
    const scheduledFor = this.resolveSchedule(req.preferredDate, req.desiredSlot, weather);

    const basePrice = SLOT_BASE_PRICE[req.desiredSlot];
    const formatsPrice = req.formats.reduce((acc, f) => acc + FORMAT_PRICE[f], 0);
    const extraGuests = Math.max(0, req.guestCount - 2);
    const totalBRL = basePrice + formatsPrice + extraGuests * GUEST_SURCHARGE_PER_EXTRA;

    const confirmation: BookingConfirmation = {
      bookingId: randomUUID(),
      status: score >= 65 ? 'confirmed' : score >= 40 ? 'pending_weather' : 'awaiting_payment',
      scheduledFor,
      weatherScore: score,
      totalBRL,
      deliverables: req.formats,
      pilotCallsign: this.pilots[Math.floor(Math.random() * this.pilots.length)],
    };

    this.bookings.set(confirmation.bookingId, confirmation);
    this.emit('booking:created', confirmation);
    return confirmation;
  }

  /** Recupera reserva por id. */
  getBooking(id: string): BookingConfirmation | undefined {
    return this.bookings.get(id);
  }

  /** Lista reservas ativas (status confirmed ou pending_weather). */
  listActive(): BookingConfirmation[] {
    return [...this.bookings.values()].filter(
      (b) => b.status === 'confirmed' || b.status === 'pending_weather',
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private simulateWeatherWindow(date: Date, slot: SlotKind): WeatherWindow {
    const seed = date.getUTCDate() + slot.length;
    const wind = 6 + (seed % 18); // 6–24 km/h
    const precip = seed % 7 === 0 ? 1.2 : 0; // chuva esparsa alguns dias
    const visibility = 8 + (seed % 7);
    const cloud = 10 + (seed % 60);

    const startsAt = new Date(date);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000); // janela de 1h
    return {
      startsAt,
      endsAt,
      windKmh: wind,
      precipitationMm: precip,
      visibilityKm: visibility,
      cloudCoverPct: cloud,
    };
  }

  private scoreWeather(w: WeatherWindow, slot: SlotKind): number {
    let score = 100;
    if (w.windKmh > 18) score -= 25;
    else if (w.windKmh > 12) score -= 10;
    if (w.precipitationMm > 0) score -= 40;
    if (w.visibilityKm < 9) score -= 15;
    if (slot === 'golden_hour' && w.cloudCoverPct > 60) score -= 10;
    if (slot === 'night_sky' && w.cloudCoverPct > 40) score -= 20;
    return Math.max(0, Math.min(100, score));
  }

  private resolveSchedule(preferred: Date, slot: SlotKind, w: WeatherWindow): Date {
    if (slot === 'golden_hour') return new Date(w.startsAt.getTime() - 30 * 60 * 1000);
    if (slot === 'blue_hour') return w.startsAt;
    return w.startsAt;
  }
}

// Singleton export para integração com booking-orchestrator.
export const cinemaDroneBookingEngine = new CinemaDroneBookingEngine();
