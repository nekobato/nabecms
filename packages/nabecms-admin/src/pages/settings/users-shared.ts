export interface RoleItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export interface UserItem {
  id: string;
  email: string;
  name: string;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
  isSystemUser: boolean;
}

export interface InviteItem {
  emailDelivery?: { status: "accepted" | "failed" };
  canResend?: boolean;
  id: string;
  email: string;
  roleIds: string[];
  status: string;
  expiresAt: string;
  sentAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface TokenPreview {
  email: string;
  token: string;
  expiresAt: string;
}

export type TagSeverity = "success" | "info" | "warn" | "danger" | "secondary";
