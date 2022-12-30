export const ERROR = {
  PASSWORD_WEAK: "auth/weak-password",
  PASSWORD_WRONG: "auth/wrong-password",
  TOKEN_INVALID: "auth/invalid-action-code",
  EMAIL_IN_USE: "auth/email-already-in-use",
  EMAIL_INVALID: "auth/invalid-email",
  EMAIL_NOT_FOUND: "auth/user-not-found",
};

export const getError = (code) => {
  switch (code) {
    case ERROR.PASSWORD_WEAK:
      return "Password must be at least 12 characters";
    case ERROR.PASSWORD_WRONG:
      return "Invalid password";
    case ERROR.TOKEN_INVALID:
      return "Invalid token, resend link to reset password";
    case ERROR.EMAIL_IN_USE:
      return "Email already in use";
    case ERROR.EMAIL_INVALID:
      return "Invalid email";
    case ERROR.EMAIL_NOT_FOUND:
      return "User not found";
    default:
      return "Unknown error occurred, please try again later!";
  }
};
