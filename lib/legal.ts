// Details of the operator (the person or company that runs Мысль) for the legal pages:
// /privacy, /terms and /consent. Fill every null before the public launch. While any is null,
// the pages show a "not in force yet" notice and the empty places are highlighted.

export interface Operator {
  /** Full name: «Индивидуальный предприниматель Иванов Иван Иванович» or «ООО "Мысль"». */
  name: string | null;
  /** ИНН. */
  inn: string | null;
  /** ОГРН or ОГРНИП. */
  ogrn: string | null;
  /** Postal address for letters and claims. */
  address: string | null;
  /** Email for questions about personal data and for claims. */
  email: string | null;
}

export const OPERATOR: Operator = {
  name: null,
  inn: null,
  ogrn: null,
  address: null,
  email: null,
};

/** Date from which this wording applies, «1 ноября 2026 г.». */
export const LEGAL_EDITION: string | null = null;

export const legalReady = Object.values(OPERATOR).every(Boolean) && Boolean(LEGAL_EDITION);
