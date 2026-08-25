import jwt from 'jsonwebtoken';

export function signAccessToken(user: { id: string; email: string }, secret: string) {
  return jwt.sign({ sub: user.id, email: user.email }, secret, {
    expiresIn: `${Number(process.env.ACCESS_TOKEN_MINUTES || 60)}m` as any,
  });
}
