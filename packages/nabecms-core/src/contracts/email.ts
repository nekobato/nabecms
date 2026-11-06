/** Optional authentication email settings owned by the CMS administrator. */
export type EmailSettings = {
  senderName: string;
  invitesEnabled: boolean;
  passwordResetEnabled: boolean;
};
export type EmailDelivery = {
  status: "accepted" | "failed";
  purpose: "test" | "invite" | "password_reset";
  at: string;
  errorCode: "EMAIL_DELIVERY_FAILED" | null;
};
export type EmailSettingsResponse = {
  item: EmailSettings;
  environment: {
    configured: boolean;
    from: string | null;
    baseUrl: string | null;
    missing: string[];
  };
  lastDelivery: EmailDelivery | null;
};
