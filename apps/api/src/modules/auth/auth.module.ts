import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { MailModule } from '../mail/mail.module';
import { SecurityModule } from '../../common/security/security.module';
import { SessionModule } from './session.module';
import { AuthMiddlewareModule } from './auth-middleware.module';
import { LockoutModule } from './lockout.module';
import { AuthSharedService } from './services/auth-shared.service';
import { SudoService } from './services/sudo.service';
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
import { TwoFactorAdminResetService } from './services/two-factor-admin-reset.service';
import { TrustedDeviceService } from './services/trusted-device.service';
import { TokenRepository } from './repositories/token.repository';
import { SecondFactorRepository } from './repositories/second-factor.repository';
import { SessionManagementService } from './services/session-management.service';
import { AuthRouter } from './auth.router';
import { SessionsRouter } from './sessions.router';
import { TwoFactorRouter } from './two-factor.router';

/**
 * AuthModule depends on UserModule (for UserService data lookups). The
 * inverse edge (UserModule needing AuthMiddleware) is handled via the
 * standalone AuthMiddlewareModule, which UserModule imports directly. That
 * removes the circular dependency that previously required `forwardRef`.
 */
@Module({
  imports: [
    UserModule,
    MailModule,
    SecurityModule,
    SessionModule,
    AuthMiddlewareModule,
    LockoutModule,
  ],
  providers: [
    SudoService,
    TokenRepository,
    SecondFactorRepository,
    AuthSharedService,
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
    TwoFactorAdminResetService,
    TrustedDeviceService,
    SessionManagementService,
    AuthRouter,
    SessionsRouter,
    TwoFactorRouter,
  ],
  exports: [LockoutModule],
})
export class AuthModule {}
