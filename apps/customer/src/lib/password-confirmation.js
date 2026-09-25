export function passwordConfirmationError(password, confirmation) {
  if (!confirmation) return "Please confirm your password.";
  if (password !== confirmation) return "Passwords do not match.";
  return "";
}
