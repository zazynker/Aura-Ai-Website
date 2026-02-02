import { env, isSupabaseConfigured } from '../config/env';

/**
 * Environment Variables Health Check
 * Run this to verify your configuration
 */
export function checkEnvironment() {
  console.log('🔍 Environment Variables Check');
  console.log('================================');
  
  // Check Supabase configuration
  console.log('\n📦 Supabase:');
  console.log(`   URL: ${env.supabase.url ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   Anon Key: ${env.supabase.anonKey ? '✅ Configured' : '❌ Missing'}`);
  
  if (env.supabase.url) {
    console.log(`   Project: ${env.supabase.url.split('//')[1]?.split('.')[0] || 'unknown'}`);
  }
  
  // Check app configuration
  console.log('\n🌐 Application:');
  console.log(`   URL: ${env.app.url}`);
  console.log(`   Mode: ${env.app.isDev ? 'Development' : 'Production'}`);
  
  // Overall status
  console.log('\n📊 Status:');
  const isConfigured = isSupabaseConfigured();
  if (isConfigured) {
    console.log('   ✅ All required environment variables are set');
  } else {
    console.log('   ❌ Missing required environment variables');
    console.log('   💡 Check your .env.local file');
  }
  
  return isConfigured;
}

// Auto-run in development
if (import.meta.env.DEV) {
  checkEnvironment();
}