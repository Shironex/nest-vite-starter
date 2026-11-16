import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { MailModule } from '../mail/mail.module';
import { EventsModule } from '../events/events.module';
import { SecurityModule } from '../../common/security/security.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { SessionModule } from './session.module';
import { AuthMiddlewareModule } from './auth-middleware.module';
import { LockoutModule } from './lockout.module';
import { AuthSharedService } from './services/auth-shared.service';
import { SudoService } from './services/sudo.service';
import { ProvisioningService } from './services/provisioning.service';
import { RegisterService } from './services/register.service';
import { LoginService } from './services/login.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordChangeService } from './services/password-change.service';
import { EmailChangeService } from './services/email-change.service';
import { AccountDeletionService } from './services/account-deletion.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { TokenCleanupService } from './services/token-cleanup.service';
import { TwoFactorCleanupService } from './services/two-factor-cleanup.service';
import { TurnstileService } from './services/turnstile.service';
import { TotpService } from './services/totp.service';
import { TwoFactorService } from './services/two-factor.service';
import { StepUpService } from './services/step-up.service';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';
import { TwoFactorPolicyService } from './services/two-factor-policy.service';
import { TrustedDeviceService } from './services/trusted-device.service';
import { TokenRepository } from './repositories/token.repository';
import { SecondFactorRepository } from './repositories/second-factor.repository';
import { SessionManagementService } from './services/session-management.service';
import { StaffInviteService } from './staff-invite/staff-invite.service';
import { StaffInviteRepository } from './staff-invite/staff-invite.repository';
import { StaffInviteRouter } from './staff-invite/staff-invite.router';
import { AuthRouter } from './auth.router';
import { SessionsRouter } from './sessions.router';
import { TwoFactorRouter } from './two-factor.router';
import { TwoFactorEnforcementQueueModule } from './two-factor-enforcement/two-factor-enforcement-queue.module';
import { TwoFactorEnforcementProcessor } from './two-factor-enforcement/two-factor-enforcement.processor';
import { TwoFactorEnforcementScheduler } from './two-factor-enforcement/two-factor-enforcement.scheduler';

/**
 * AuthModule depends on UserModule (for UserService data lookups). The
 * inverse edge (UserModule needing AuthMiddleware) is handled via the
 * standalone AuthMiddlewareModule, which UserModule imports directly. That
 * removes the circular dependency that previously required `forwardRef`.
 *
 * EventsModule is imported for EventsService.disconnectUser: the session
 * revocation flows (logoutAll, password change/reset) must also drop live
 * websockets. No cycle: EventsModule only imports SessionModule.
 *
 * IdempotencyModule provides the IdempotencyMiddleware that AuthRouter wires
 * method-level after auth on changePassword.
 */
@Module({
  imports: [
    UserModule,
    MailModule,
    EventsModule,
    SecurityModule,
    SessionModule,
    AuthMiddlewareModule,
    LockoutModule,
    IdempotencyModule,
    // Two-factor enforcement (SPEC 6.4, T07). The queue registration lives in
    // this leaf so the scheduler (producer) and processor (consumer) below share
    // one queue instance; the processor's collaborators (TrustedDeviceService
    // here, SessionRevocationService via EventsModule, MailService via
    // MailModule, AuditService global) all resolve inside this injector.
    TwoFactorEnforcementQueueModule,
  ],
  providers: [
    SudoService,
    TokenRepository,
    SecondFactorRepository,
    AuthSharedService,
    ProvisioningService,
    RegisterService,
    LoginService,
    EmailVerificationService,
    PasswordResetService,
    PasswordChangeService,
    EmailChangeService,
    AccountDeletionService,
    PasswordService,
    TokenService,
    TokenCleanupService,
    TwoFactorCleanupService,
    TurnstileService,
    TotpService,
    StepUpService,
    TwoFactorService,
    TwoFactorChallengeService,
    TwoFactorPolicyService,
    TrustedDeviceService,
    SessionManagementService,
    // Staff invitations into an existing organization. Lives in this
    // injector because it needs TokenRepository, PasswordService, MailService
    // and UserService.revokeAuthState, all of which are already here.
    StaffInviteRepository,
    StaffInviteService,
    StaffInviteRouter,
    AuthRouter,
    SessionsRouter,
    TwoFactorRouter,
    TwoFactorEnforcementProcessor,
    TwoFactorEnforcementScheduler,
  ],
  exports: [LockoutModule],
})
export class AuthModule {}
