/**
 * supabaseClient.js
 * Single Supabase client instance shared across the app.
 * Must be loaded before db.js and auth.js.
 */
const _supabase = supabase.createClient(
  'https://nxhwmxepiepwjdhvbnvr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54aHdteGVwaWVwd2pkaHZibnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDQ2MzAsImV4cCI6MjA5MjM4MDYzMH0.tjF5MH5tq2nnuvV52SOEkGleeseUqRDsQxewkuSMdos'
);
