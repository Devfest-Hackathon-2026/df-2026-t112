/** 規約への同意(#34 の D26、#37 の UserDoc.consent)。 */
export type Consent = {
  /** 同意した規約のバージョン(文面を変えた日。例:"2026-11-10")。 */
  termsVersion: string;
  agreedAt: number;
  /** 18 歳以上であることを確認したか。 */
  ageConfirmed: boolean;
};

/** ユーザーの情報(#37 の users/{uid})。今は規約への同意だけを持つ。ほかの項目は、アカウントの作成で足す。 */
export interface UserStore {
  /** 同意していなければ null。 */
  getConsent(uid: string): Promise<Consent | null>;
  saveConsent(uid: string, consent: Consent): Promise<void>;
}

export class MemoryUserStore implements UserStore {
  private consents = new Map<string, Consent>();

  async getConsent(uid: string): Promise<Consent | null> {
    return this.consents.get(uid) ?? null;
  }

  async saveConsent(uid: string, consent: Consent): Promise<void> {
    this.consents.set(uid, consent);
  }
}
