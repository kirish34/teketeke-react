import { useAuth } from '../state/auth'

export function useProfile() {
  const { user, loading, error } = useAuth()
  return { profile: user, loading, error }
}
