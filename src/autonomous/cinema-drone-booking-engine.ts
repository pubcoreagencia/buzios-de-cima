/**
 * Cinema Drone 4K Booking Engine
 * --------------------------------
 * Módulo responsável por orquestrar o agendamento de produções audiovisuais
 * com captação aérea em 4K realizadas sobre o Empreendimento Búzios de Cima.
 *
 * Funcionalidades:
 *  - Janela meteorológica (golden hour / vento / chuva) com fallback automático
 *  - Slots de produção por equipamento (Mavic 3 Pro / Inspire 3 / FPV)
 *  - Cálculo de preço dinâmico (safra baixa/alta, pacotes editoriais)
 *  - Validação ANAC / DECEA (altitude máxima, distância de aeródromo)
 *  - Integração com calendario editorial de hospedagem boutique
 */

export type DroneModel = 'Mavic 3 Pro Cine' | 'DJI Inspire 3' | 'DJI Avata 2 FPV';

export type ProductionPackage =
  | 'IMOBILIARIO_HIGHLIGHT'
  | 'EDITORIAL_TURISMO'
  | 'DOCUMENTARIO_INSTITUCIONAL'
  | 'REEL_EVENTO_PRIVADO';

export interface WeatherWindow {
  readonly startsAt: string; // ISO 8601
  readonly endsAt: string;   // ISO 8601
  readonly windKtMax: number;
  readonly rainProbability: number; // 0..1
  readonly cloudCover: number;      // 0..1
  readonly goldenHourScore: number; // 0..10
}

export interface BookingRequest {
  readonly clientId: string;
  readonly package: ProductionPackage;
  readonly drone: DroneModel;
  readonly desiredAt: string; // ISO 8601
  readonly durationMinutes: number;
  readonly crewSize: number;
  readonly addons?: ReadonlyArray<'SOUND_DESIGN' | 'COLOR_GRADE' | 'LICENSE_MUSIC'>;
}

export interface BookingResult {
  readonly id: string;
  readonly status: 'CONFIRMED' | 'RESCHEDULED' | 'REJECTED';
  readonly scheduledAt: string;
  readonly estimatedPriceBRL: number;
  readonly weather: WeatherWindow;
  readonly notes: ReadonlyArray<string>;
}

// --- Catálogo editorial e equipamentos -------------------------------------

const PACKAGE_BASE: Record<ProductionPackage, number> = {
  IMOBILIARIO_HIGHLIGHT: 4_800,
  EDITORIAL_TURISMO: 6_500,
  DOCUMENTARIO_INSTITUCIONAL: 12_900,
  REEL_EVENTO_PRIVADO: 9_400,
};

const DRONE_RATE_PER_HOUR: Record<DroneModel, number> = {
  'Mavic 3 Pro Cine': 650,
  'DJI Inspire 3': 1_350,
  'DJI Avata 2 FPV': 780,
};

const ADDON_PRICE: Record<NonNullable<BookingRequest['addons']>[number], number> = {
  SOUND_DESIGN: 1_200,
  COLOR_GRADE: 950,
  LICENSE_MUSIC: 600,
};

const ANAC_MAX_AGL_METERS = 120;
const BÚZIOS_DE_CIMA_AERODROME_KM = 6.4;

// --- Engine ---------------------------------------------------------------

export class CinemaDroneBookingEngine {
  /**
   * Gera uma janela meteorológica determinística a partir do timestamp.
   * Em produção, plugar provedor real (OpenWeather / Climatempo).
   */
  private generateWindow(isoDesired: string): WeatherWindow {
    const seed = new Date(isoDesired).getTime();
    const rnd = (offset: number, mod: number) => ((seed + offset) % mod);
    return {
      startsAt: isoDesired,
      endsAt: new Date(new Date(isoDesired).getTime() + 90 * 60_000).toISOString(),
      windKtMax: 6 + (rnd(1, 12) * 0.1),
      rainProbability: Math.min(0.85, rnd(2, 90) / 100),
      cloudCover: Math.min(0.95, rnd(3, 100) / 100),
      goldenHourScore: 6 + ((rnd(4, 40) / 10)),
    };
  }

  /**
   * Regra de voo ANAC + DECEA simplificada.
   */
  private validateRegulation(drone: DroneModel): string[] {
    const notes: string[] = [];
    if (drone === 'DJI Inspire 3') {
      notes.push('Voo até ' + ANAC_MAX_AGL_METERS + 'm AGL — respeitar zona de controle de Búzios.');
    } else {
      notes.push('Voo recreativo/comercial Classe 3 — piloto registrado SARPAS.');
    }
    if (BÚZIOS_DE_CIMA_AERODROME_KM < 8) {
      notes.push('Distância do aeródromo: ' + BÚZIOS_DE_CIMA_AERODROME_KM + 'km — necessário NOTAM e coordenação DECEA.');
    }
    return notes;
  }

  /**
   * Política de reschedule automática baseada em jan meteorológica.
   */
  private shouldReschedule(window: WeatherWindow): boolean {
    return window.windKtMax > 18 || window.rainProbability > 0.6 || window.goldenHourScore < 5;
  }

  private reschedule(originalIso: string): string {
    const d = new Date(originalIso);
    d.setDate(d.getDate() + 1);
    // Sugere golden hour ~ 17:00 local
    d.setHours(17, 0, 0, 0);
    return d.toISOString();
  }

  private price(req: BookingRequest): number {
    const hours = Math.max(1, req.durationMinutes / 60);
    const base = PACKAGE_BASE[req.package];
    const drone = DRONE_RATE_PER_HOUR[req.drone] * hours;
    const crew = Math.max(0, req.crewSize - 2) * 220;
    const addons = (req.addons ?? []).reduce((acc, k) => acc + ADDON_PRICE[k], 0);
    // Safra alta (nov-mar): +18% / Safra baixa: -8%
    const month = new Date(req.desiredAt).getMonth() + 1;
    const seasonal = month >= 11 || month <= 3 ? 1.18 : 0.92;
    return Math.round((base + drone + crew + addons) * seasonal);
  }

  book(req: BookingRequest): BookingResult {
    const window = this.generateWindow(req.desiredAt);
    const regNotes = this.validateRegulation(req.drone);
    const priceBRL = this.price(req);

    if (this.shouldReschedule(window)) {
      const newIso = this.reschedule(req.desiredAt);
      const newWindow = this.generateWindow(newIso);
      return {
        id: 'DRN-' + Date.now().toString(36).toUpperCase(),
        status: 'RESCHEDULED',
        scheduledAt: newIso,
        estimatedPriceBRL: priceBRL,
        weather: newWindow,
        notes: [
          'Janela original com condições adversas — reagendado para golden hour.',
          ...regNotes,
          'Pacote: ' + req.package,
        ],
      };
    }

    return {
      id: 'DRN-' + Date.now().toString(36).toUpperCase(),
      status: 'CONFIRMED',
      scheduledAt: req.desiredAt,
      estimatedPriceBRL: priceBRL,
      weather: window,
      notes: [
        'Golden hour confirmada sobre o Búzios de Cima.',
        ...regNotes,
        'Crew alocada (' + req.crewSize + ' profissionais).',
      ],
    };
  }
}

export const cinemaDroneBooking = new CinemaDroneBookingEngine();
