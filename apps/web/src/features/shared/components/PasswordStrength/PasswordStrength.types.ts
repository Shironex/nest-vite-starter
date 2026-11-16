export interface IPasswordStrengthProps {
  readonly password: string;
}

export interface IPasswordRequirement {
  readonly label: string;
  readonly met: boolean;
}

export interface IPasswordStrengthView {
  readonly requirements: readonly IPasswordRequirement[];
}
