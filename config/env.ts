/**
 * Environment Configuration
 * Centralized access to environment variables with validation
 */

// Validate required environment variables
const requiredEnvVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ] as const;
  
  function validateEnv() {
    const missing: string[] = [];
    
    requiredEnvVars.forEach((key) => {
      if (!import.meta.env[key]) {
        missing.push(key);
      }
    });
  
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:');
      missing.forEach((key) => console.error(`   - ${key}`));
      console.error('\n💡 Please check your .env.local file');
    }
  }
  
  // Run validation in development
  if (import.meta.env.DEV) {
    validateEnv();
  }
  
  // Export environment variables
  export const env = {
    supabase: {
      url: import.meta.env.VITE_SUPABASE_URL || '',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    },
    app: {
      url: import.meta.env.VITE_APP_URL || 'http://localhost:3000',
      isDev: import.meta.env.DEV,
      isProd: import.meta.env.PROD,
    },
  } as const;
  
  // Type guard to check if Supabase is configured
  export function isSupabaseConfigured(): boolean {
    return !!(env.supabase.url && env.supabase.anonKey);
  }