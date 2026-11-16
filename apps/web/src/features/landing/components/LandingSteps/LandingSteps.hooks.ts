import type { ILandingStep, ILandingStepsView } from './LandingSteps.types';

/** What a new user can do on day one, in the order they do it. */
const STEPS: ILandingStep[] = [
  {
    number: '01',
    title: 'Create an account',
    description:
      'Sign up with email or Google. The account works right away, no sales call needed.',
  },
  {
    number: '02',
    title: 'Set up your organization',
    description:
      'Add the organizations you work with. Everything you create belongs to one of them.',
  },
  {
    number: '03',
    title: 'Invite your team',
    description: 'Send invitations and pick a role for each person. Access follows the role.',
  },
  {
    number: '04',
    title: 'Stay in control',
    description:
      'Two-factor sign-in, session management and an audit log are switched on from the start.',
  },
];

export function useLandingSteps(): ILandingStepsView {
  return { steps: STEPS };
}
