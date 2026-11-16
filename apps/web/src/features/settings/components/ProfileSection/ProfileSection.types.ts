export interface IProfileSectionView {
  readonly displayName: string;
  readonly email: string;
  readonly role: string;
  readonly emailVerified: boolean;
  readonly initials: string;
  readonly displayAvatarUrl: string | undefined;
  /** True while the presigned avatar URL is being resolved (render a skeleton). */
  readonly avatarLoading: boolean;
  /** True when the avatar URL lookup failed (fall back to initials). */
  readonly avatarError: boolean;
  readonly onUploadComplete: (key: string, url: string) => void;
  readonly onUploadError: (error: string) => void;
}
