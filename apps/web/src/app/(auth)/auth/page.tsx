// apps/web/src/app/(auth)/auth/page.tsx
"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertCircle,
  Building2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthContext } from "@/components/auth/auth-context";
import { useSession } from "@/providers/session-provider";
import {
  authApi,
  AuthNetworkError,
  AuthRateLimitError,
  FEATURE_PHONE_AUTH,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";

// Step 1 Validation Schema
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
// Optional phone regex if FEATURE_PHONE_AUTH is enabled
// const vnPhoneRegex = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;

const identifierSchema = z.object({
  identifier: z
    .string()
    .min(1, "Vui lòng nhập địa chỉ email")
    .refine((val) => {
      const trimmed = val.trim();
      return emailRegex.test(trimmed);
    }, "Vui lòng nhập địa chỉ email hợp lệ"),
});

// Step 2a Password Schema
const passwordSchema = z.object({
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});

// Step 2b Register Schema
const registerSchema = z.object({
  fullName: z
    .string()
    .min(2, "Họ và tên tối thiểu 2 ký tự")
    .max(100, "Họ và tên tối đa 100 ký tự"),
  organizationName: z.string().optional(),
  password: z
    .string()
    .min(8, "Mật khẩu phải có tối thiểu 8 ký tự")
    .max(100, "Mật khẩu tối đa 100 ký tự"),
});

type IdentifierInput = z.infer<typeof identifierSchema>;
type PasswordInput = z.infer<typeof passwordSchema>;
type RegisterInput = z.infer<typeof registerSchema>;

function AuthFlowContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get("step");

  const { identifier, setIdentifier, roleTab, setRoleTab } = useAuthContext();
  const { login: sessionLogin } = useSession();

  // Active step calculation: If no identifier in memory, gracefully default to "identifier" step
  const activeStep: "identifier" | "password" | "register" =
    (stepParam === "password" || stepParam === "register") && identifier
      ? stepParam
      : "identifier";

  // Screen-reader announcement
  const [announcement, setAnnouncement] = useState("");

  // Step 1 State
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [step1NetworkError, setStep1NetworkError] = useState(false);
  const [rateLimitTimer, setRateLimitTimer] = useState<number | null>(null);

  // Step 2a (Password) State
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // TODO(contract): POST /api/v1/auth/login lacks rememberMe option; state handled on client.
  const [rememberMe, setRememberMe] = useState(false);

  // Step 2b (Register) State
  const [registerError, setRegisterError] = useState<string | null>(null);

  // Refs for auto-focusing
  const identifierInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const fullNameInputRef = useRef<HTMLInputElement>(null);

  // Forms
  const {
    register: registerId,
    handleSubmit: handleIdSubmit,
    setValue: setIdValue,
    getValues: getValuesId,
    formState: { errors: idErrors, isSubmitting: isCheckingId },
  } = useForm<IdentifierInput>({
    resolver: zodResolver(identifierSchema),
    defaultValues: { identifier },
  });

  const {
    register: registerPass,
    handleSubmit: handlePassSubmit,
    setValue: setPassValue,
    formState: { errors: passErrors, isSubmitting: isLoggingIn },
  } = useForm<PasswordInput>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "" },
  });

  const {
    register: registerReg,
    handleSubmit: handleRegSubmit,
    watch: watchReg,
    formState: { errors: regErrors, isSubmitting: isRegistering },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      organizationName: "",
      password: "",
    },
  });

  // eslint-disable-next-line react-hooks/incompatible-library -- React Hook Form watch is intentional to preserve component runtime behavior
  const watchedPassword = watchReg("password");

  // Keep form value in sync when returning with prefilled identifier
  useEffect(() => {
    if (identifier) {
      setIdValue("identifier", identifier);
    }
  }, [identifier, setIdValue]);

  // Rate-limit countdown timer
  useEffect(() => {
    if (rateLimitTimer === null || rateLimitTimer <= 0) return;
    const interval = setInterval(() => {
      setRateLimitTimer((prev) => (prev && prev > 1 ? prev - 1 : null));
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimitTimer]);

  // Auto-focus on active step transition
  useEffect(() => {
    if (activeStep === "identifier") {
      setAnnouncement("Bước 1: Nhập email tài khoản");
      setTimeout(() => {
        identifierInputRef.current?.focus();
        if (identifier) {
          identifierInputRef.current?.select();
        }
      }, 50);
    } else if (activeStep === "password") {
      setAnnouncement("Bước 2: Nhập mật khẩu đăng nhập");
      setTimeout(() => {
        passwordInputRef.current?.focus();
      }, 50);
    } else if (activeStep === "register") {
      setAnnouncement("Bước 2: Điền thông tin tạo tài khoản");
      setTimeout(() => {
        fullNameInputRef.current?.focus();
      }, 50);
    }
  }, [activeStep, identifier]);

  // Return to step 1
  const handleBackToIdentifier = () => {
    setLoginError(null);
    setRegisterError(null);
    setStep1Error(null);
    setPassValue("password", "");
    router.push("/auth");
  };

  // Step 1: Submit Identifier
  const onIdentifierSubmit = async (data: IdentifierInput) => {
    setStep1Error(null);
    setStep1NetworkError(false);
    const cleanId = data.identifier.trim();

    try {
      const result = await authApi.checkIdentifier(cleanId);
      setIdentifier(cleanId);

      if (result.exists) {
        router.push("/auth?step=password");
      } else {
        router.push("/auth?step=register");
      }
    } catch (err) {
      if (err instanceof AuthRateLimitError) {
        setStep1Error(err.message);
        setRateLimitTimer(err.retryAfter);
      } else if (err instanceof AuthNetworkError) {
        setStep1Error(err.message);
        setStep1NetworkError(true);
      } else {
        setStep1Error(
          "Không thể kiểm tra tài khoản lúc này. Vui lòng thử lại sau.",
        );
        setStep1NetworkError(true);
      }
    }
  };

  // Step 2a: Submit Password
  const onPasswordSubmit = async (data: PasswordInput) => {
    setLoginError(null);
    try {
      const result = await authApi.login({
        email: identifier,
        password: data.password,
      });

      if (result) {
        sessionLogin(result);
      }

      const redirectParam = searchParams.get("redirect");
      if (
        redirectParam &&
        redirectParam.startsWith("/") &&
        !redirectParam.startsWith("/auth") &&
        !redirectParam.startsWith("/login")
      ) {
        router.push(redirectParam);
        return;
      }

      if (result?.user?.role === "ADMIN") {
        router.push("/admin");
      } else if (result?.user?.role === "ORGANIZER") {
        router.push("/organizer/events");
      } else {
        router.push("/");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setLoginError(err.message);
      } else {
        setLoginError("Mật khẩu không chính xác. Vui lòng kiểm tra lại.");
      }
      setTimeout(() => {
        passwordInputRef.current?.focus();
        passwordInputRef.current?.select();
      }, 50);
    }
  };

  // Step 2b: Submit Register
  const onRegisterSubmit = async (data: RegisterInput) => {
    setRegisterError(null);
    try {
      // TODO(contract): API_CONTRACT.md lacks organizationName; handled on frontend
      await authApi.register({
        email: identifier,
        password: data.password,
        fullName: data.fullName,
        role: roleTab,
      });
      router.push(`/verify-email?email=${encodeURIComponent(identifier)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        // Edge Case: Registration Race (Account was created between check and submit)
        if (
          err.status === 409 ||
          err.message.toLowerCase().includes("đã được sử dụng") ||
          err.message.toLowerCase().includes("tồn tại")
        ) {
          router.push("/auth?step=password");
          setLoginError("Tài khoản đã tồn tại. Hãy đăng nhập.");
          return;
        }
        setRegisterError(err.message);
      } else {
        setRegisterError(
          "Không thể tạo tài khoản lúc này. Vui lòng thử lại sau.",
        );
      }
    }
  };

  return (
    <div
      data-slot="auth-stage form-wrapper"
      className="stage w-full max-w-[440px] mx-auto my-auto grid grid-cols-1 [grid-template-rows:1fr] items-start [transform:translateY(var(--auth-stage-offset,-3vh))] motion-reduce:transform-none"
    >
      {/* Screen-reader Live Region */}
      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>

      {/* Sizer / Ghost for Tallest Step (Organizer Register)
          Maintains constant stage min-height without JS or hardcoded magic numbers */}
      <div
        data-slot="stage-sizer"
        aria-hidden="true"
        tabIndex={-1}
        className="col-start-1 row-start-1 w-full self-start invisible pointer-events-none select-none flex flex-col gap-7"
      >
        <div className="flex flex-col gap-2 text-left">
          <div className="text-[28px] leading-8 font-semibold tracking-tight text-foreground">
            Tạo tài khoản
          </div>
          <div className="text-base text-muted-foreground leading-normal">
            Đăng ký tài khoản ban tổ chức để bắt đầu tạo sự kiện.
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-5">
            {/* Identifier Chip Row */}
            <div className="h-12 w-full flex items-center justify-between px-3.5 rounded-lg border border-border bg-muted/50 text-foreground">
              <div className="flex items-center gap-2.5 min-w-0">
                <User className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate text-foreground">
                  {identifier || "user@example.com"}
                </span>
              </div>
              <span className="h-11 px-2.5 text-sm font-semibold text-primary flex items-center">
                Đổi
              </span>
            </div>

            {/* Full name field */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Họ và tên
              </span>
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <User className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <div className="h-12 pl-11 pr-3.5 rounded-lg border border-muted-foreground" />
                </div>
              </div>
            </div>

            {/* Organizer-only field */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Tên Tổ chức / Doanh nghiệp
              </span>
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <Building2 className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <div className="h-12 pl-11 pr-3.5 rounded-lg border border-muted-foreground" />
                </div>
              </div>
            </div>

            {/* Password field */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Mật khẩu
              </span>
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <Lock className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <div className="h-12 pl-11 pr-11 rounded-lg border border-muted-foreground" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground p-1">
                    <Eye className="size-5" />
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                  <span>Tối thiểu 8 ký tự</span>
                </div>
              </div>
            </div>

            {/* Role switch link placeholder */}
            <div className="pt-1">
              <span className="text-xs sm:text-[13px] text-transparent select-none inline-block h-5">
                Role switch link placeholder
              </span>
            </div>
          </div>

          {/* Submit button & Consent line */}
          <div className="flex flex-col gap-3">
            <div className="w-full h-12 rounded-lg font-semibold text-base bg-primary text-primary-foreground flex items-center justify-center">
              Tạo tài khoản
            </div>
            <div className="text-xs text-muted-foreground text-center leading-relaxed">
              Bằng việc tiếp tục, bạn đồng ý với{" "}
              <span className="font-semibold">Điều khoản sử dụng</span> và{" "}
              <span className="font-semibold">Chính sách bảo mật</span>.
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================
          STEP 1: IDENTIFIER
          Title, Subtitle, 1 Field, 1 Primary Button, 1 Consent Line
          ======================================================== */}
      {activeStep === "identifier" && (
        <div className="col-start-1 row-start-1 w-full self-start flex flex-col gap-7 animate-in fade-in-50 duration-200 motion-reduce:animate-none">
          <header className="flex flex-col gap-2 text-left">
            <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-foreground">
              Đăng nhập hoặc tạo tài khoản
            </h1>
            <p className="text-base text-muted-foreground leading-normal">
              Nhập email của bạn để tiếp tục.
            </p>
          </header>

          <form
            onSubmit={handleIdSubmit(onIdentifierSubmit)}
            noValidate
            className="flex flex-col gap-6"
          >
            {/* Edge Case Alerts (Network Error, Rate Limit, etc.) */}
            {step1Error && (
              <div
                role="alert"
                className="flex items-start justify-between gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs sm:text-[13px] font-medium text-destructive"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{step1Error}</span>
                </div>
                {step1NetworkError && (
                  <button
                    type="button"
                    onClick={() => {
                      const curVal = getValuesId("identifier");
                      if (curVal) onIdentifierSubmit({ identifier: curVal });
                    }}
                    className="underline hover:no-underline font-semibold text-destructive shrink-0 cursor-pointer"
                  >
                    Thử lại
                  </button>
                )}
              </div>
            )}

            {/* Single Identifier Field */}
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="identifier"
                className="text-sm font-medium text-foreground"
              >
                {FEATURE_PHONE_AUTH ? "Email hoặc số điện thoại" : "Email"}
              </Label>
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <Mail className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    {...registerId("identifier")}
                    ref={(e) => {
                      registerId("identifier").ref(e);
                      identifierInputRef.current = e;
                    }}
                    id="identifier"
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    autoFocus
                    required
                    aria-required="true"
                    placeholder="Ví dụ: nguyenan@example.com"
                    className={`h-12 pl-11 pr-3.5 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                      idErrors.identifier
                        ? "border-destructive focus-visible:border-destructive"
                        : "border border-muted-foreground hover:border-foreground"
                    }`}
                    aria-invalid={!!idErrors.identifier}
                    aria-describedby={
                      idErrors.identifier ? "identifier-error" : undefined
                    }
                  />
                </div>
                {idErrors.identifier && (
                  <p
                    id="identifier-error"
                    role="alert"
                    className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
                  >
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>{idErrors.identifier.message}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Submit Button & Consent Line */}
            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                disabled={isCheckingId || rateLimitTimer !== null}
                className="w-full h-12 rounded-lg font-semibold text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
              >
                {isCheckingId ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-5 animate-spin" />
                    <span>Đang kiểm tra...</span>
                  </span>
                ) : rateLimitTimer !== null ? (
                  `Thử lại sau (${rateLimitTimer}s)`
                ) : (
                  "Tiếp tục"
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                Bằng việc tiếp tục, bạn đồng ý với{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-semibold hover:underline"
                >
                  Điều khoản sử dụng
                </Link>{" "}
                và{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-semibold hover:underline"
                >
                  Chính sách bảo mật
                </Link>
                .
              </p>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================
          STEP 2a: PASSWORD (ACCOUNT EXISTS)
          Title, Identifier Chip with "Đổi", Password, Remember Me, Submit
          ======================================================== */}
      {activeStep === "password" && (
        <div className="col-start-1 row-start-1 w-full self-start flex flex-col gap-7 animate-in fade-in-50 duration-200 motion-reduce:animate-none">
          <header className="flex flex-col gap-2 text-left">
            <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-foreground">
              Chào mừng trở lại
            </h1>
            <p className="text-base text-muted-foreground leading-normal">
              Nhập mật khẩu để đăng nhập vào tài khoản của bạn.
            </p>
          </header>

          <form
            onSubmit={handlePassSubmit(onPasswordSubmit)}
            noValidate
            className="flex flex-col gap-6"
          >
            {/* Visually hidden username for password managers */}
            <input
              type="text"
              name="username"
              value={identifier}
              autoComplete="username"
              readOnly
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />

            <div className="flex flex-col gap-5">
              {/* Identifier Chip Row (48px tall, neutral surface, "Đổi" button) */}
              <div
                data-slot="identifier-chip"
                className="h-12 w-full flex items-center justify-between px-3.5 rounded-lg border border-border bg-muted/50 text-foreground"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <User className="size-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate text-foreground">
                    {identifier}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleBackToIdentifier}
                  className="h-11 px-2.5 text-sm font-semibold text-primary hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md shrink-0 flex items-center"
                  aria-label={`Thay đổi tài khoản ${identifier}`}
                >
                  Đổi
                </button>
              </div>

              {/* Password field */}
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between w-full">
                  <Label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    Mật khẩu
                  </Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <Lock className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      {...registerPass("password")}
                      ref={(e) => {
                        registerPass("password").ref(e);
                        passwordInputRef.current = e;
                      }}
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      aria-required="true"
                      placeholder="Nhập mật khẩu"
                      className={`h-12 pl-11 pr-11 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                        passErrors.password || loginError
                          ? "border-destructive focus-visible:border-destructive"
                          : "border border-muted-foreground hover:border-foreground"
                      }`}
                      aria-invalid={!!passErrors.password || !!loginError}
                      aria-describedby={
                        passErrors.password ? "password-error" : undefined
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs p-1"
                      aria-label={
                        showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                    </button>
                  </div>
                  {passErrors.password && (
                    <p
                      id="password-error"
                      role="alert"
                      className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
                    >
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>{passErrors.password.message}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Remember me checkbox (whole row 44px click target, box >= 20px) */}
              <div
                id="rememberMe-row"
                className="h-11 flex items-center gap-3 select-none"
              >
                <input
                  id="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="size-5 rounded-xs border-muted-foreground text-primary focus-visible:ring-2 focus-visible:ring-ring cursor-pointer accent-primary shrink-0"
                />
                <label
                  htmlFor="rememberMe"
                  className="text-sm text-foreground font-medium cursor-pointer"
                >
                  Ghi nhớ đăng nhập
                </label>
              </div>
            </div>

            {/* Submit & Error Alert */}
            <div className="flex flex-col gap-3">
              {loginError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs sm:text-[13px] font-medium text-destructive"
                >
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoggingIn}
                className="w-full h-12 rounded-lg font-semibold text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
              >
                {isLoggingIn ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-5 animate-spin" />
                    <span>Đang đăng nhập...</span>
                  </span>
                ) : (
                  "Đăng nhập"
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================
          STEP 2b: REGISTER (NEW ACCOUNT)
          Title, Identifier Chip with "Đổi", FullName, Password, Organizer Link, Submit
          ======================================================== */}
      {activeStep === "register" && (
        <div className="col-start-1 row-start-1 w-full self-start flex flex-col gap-7 animate-in fade-in-50 duration-200 motion-reduce:animate-none">
          <header className="flex flex-col gap-2 text-left">
            <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-foreground">
              Tạo tài khoản
            </h1>
            <p className="text-base text-muted-foreground leading-normal">
              {roleTab === "ORGANIZER"
                ? "Đăng ký tài khoản ban tổ chức để bắt đầu tạo sự kiện."
                : "Hoàn tất thông tin cá nhân để hoàn tất đăng ký."}
            </p>
          </header>

          <form
            onSubmit={handleRegSubmit(onRegisterSubmit)}
            noValidate
            className="flex flex-col gap-6"
          >
            {/* Visually hidden email input for password managers */}
            <input
              type="email"
              name="email"
              value={identifier}
              autoComplete="email"
              readOnly
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />

            {registerError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs sm:text-[13px] font-medium text-destructive"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span>{registerError}</span>
              </div>
            )}

            <div className="flex flex-col gap-5">
              {/* Identifier Chip Row with "Đổi" */}
              <div
                data-slot="identifier-chip"
                className="h-12 w-full flex items-center justify-between px-3.5 rounded-lg border border-border bg-muted/50 text-foreground"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <User className="size-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate text-foreground">
                    {identifier}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleBackToIdentifier}
                  className="h-11 px-2.5 text-sm font-semibold text-primary hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md shrink-0 flex items-center"
                  aria-label={`Thay đổi tài khoản ${identifier}`}
                >
                  Đổi
                </button>
              </div>

              {/* Full name field */}
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="fullName"
                  className="text-sm font-medium text-foreground"
                >
                  Họ và tên
                </Label>
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <User className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      {...registerReg("fullName")}
                      ref={(e) => {
                        registerReg("fullName").ref(e);
                        fullNameInputRef.current = e;
                      }}
                      id="fullName"
                      type="text"
                      autoComplete="name"
                      required
                      aria-required="true"
                      placeholder="Ví dụ: Nguyễn Văn An"
                      className={`h-12 pl-11 pr-3.5 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                        regErrors.fullName
                          ? "border-destructive focus-visible:border-destructive"
                          : "border border-muted-foreground hover:border-foreground"
                      }`}
                      aria-invalid={!!regErrors.fullName}
                      aria-describedby={
                        regErrors.fullName ? "fullName-error" : undefined
                      }
                    />
                  </div>
                  {regErrors.fullName && (
                    <p
                      id="fullName-error"
                      role="alert"
                      className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
                    >
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>{regErrors.fullName.message}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Organizer-only field (if roleTab is ORGANIZER) */}
              {roleTab === "ORGANIZER" && (
                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor="organizationName"
                    className="text-sm font-medium text-foreground"
                  >
                    Tên Tổ chức / Doanh nghiệp
                  </Label>
                  <div className="flex flex-col gap-1.5">
                    <div className="relative">
                      <Building2 className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <Input
                        {...registerReg("organizationName")}
                        id="organizationName"
                        type="text"
                        autoComplete="organization"
                        required
                        aria-required="true"
                        placeholder="Ví dụ: Công ty Giải trí & Sự kiện ABC"
                        className="h-12 pl-11 pr-3.5 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors border border-muted-foreground hover:border-foreground"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Password field */}
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="register-password"
                  className="text-sm font-medium text-foreground"
                >
                  Mật khẩu
                </Label>
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <Lock className="size-5 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <Input
                      {...registerReg("password")}
                      id="register-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      aria-required="true"
                      placeholder="Nhập mật khẩu"
                      className={`h-12 pl-11 pr-11 rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${
                        regErrors.password
                          ? "border-destructive focus-visible:border-destructive"
                          : "border border-muted-foreground hover:border-foreground"
                      }`}
                      aria-invalid={!!regErrors.password}
                      aria-describedby={
                        regErrors.password
                          ? "register-password-error"
                          : "password-hint"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs p-1"
                      aria-label={
                        showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                    </button>
                  </div>

                  {/* Helper text clearly belonging to password input (6px gap) */}
                  <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                    <span id="password-hint">Tối thiểu 8 ký tự</span>
                    {watchedPassword && watchedPassword.length >= 8 && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium text-[11px]">
                        <Check className="size-3 text-emerald-600" />
                        <span>Đạt độ dài yêu cầu</span>
                      </span>
                    )}
                  </div>

                  {regErrors.password && (
                    <p
                      id="register-password-error"
                      role="alert"
                      className="flex items-center gap-1.5 text-[13px] text-destructive font-medium"
                    >
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span>{regErrors.password.message}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Role Switcher Link (Text link only, no segmented control) */}
              <div className="pt-1">
                {roleTab === "BUYER" ? (
                  <button
                    type="button"
                    onClick={() => setRoleTab("ORGANIZER")}
                    className="text-xs sm:text-[13px] text-muted-foreground hover:text-foreground text-left cursor-pointer transition-colors"
                  >
                    Bạn là ban tổ chức?{" "}
                    <span className="text-primary font-semibold hover:underline">
                      Đăng ký tại đây
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRoleTab("BUYER")}
                    className="text-xs sm:text-[13px] text-muted-foreground hover:text-foreground text-left cursor-pointer transition-colors"
                  >
                    Tài khoản cá nhân mua vé?{" "}
                    <span className="text-primary font-semibold hover:underline">
                      Đăng ký tài khoản người mua
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Submit Button & Consent Line (no consent checkbox) */}
            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                disabled={isRegistering}
                className="w-full h-12 rounded-lg font-semibold text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
              >
                {isRegistering ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-5 animate-spin" />
                    <span>Đang tạo tài khoản...</span>
                  </span>
                ) : (
                  "Tạo tài khoản"
                )}
              </Button>

              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                Bằng việc tiếp tục, bạn đồng ý với{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-semibold hover:underline"
                >
                  Điều khoản sử dụng
                </Link>{" "}
                và{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-semibold hover:underline"
                >
                  Chính sách bảo mật
                </Link>
                .
              </p>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="text-center text-sm text-muted-foreground py-12">
          Đang tải...
        </div>
      }
    >
      <AuthFlowContent />
    </Suspense>
  );
}
