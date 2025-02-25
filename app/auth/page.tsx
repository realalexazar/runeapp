"use client";
import { supabase } from "@/lib/supabaseClient";
import { useState } from "react";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSignUp() {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) {
      console.error('Error:', error.message);
      return;
    }
    
    // Access user data through data.user
    console.log('Signed up:', data.user);
  }

  async function handleSignIn() {
    const { user, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) alert(error.message);
    else alert("Logged in successfully!");
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h1 className="text-2xl font-bold mb-4">Login / Register</h1>
      <input
        type="email"
        placeholder="Email"
        onChange={(e) => setEmail(e.target.value)}
        className="mb-2 p-2 border"
      />
      <input
        type="password"
        placeholder="Password"
        onChange={(e) => setPassword(e.target.value)}
        className="mb-2 p-2 border"
      />
      <button onClick={handleSignIn} className="bg-blue-500 text-white p-2">
        Login
      </button>
      <button onClick={handleSignUp} className="bg-green-500 text-white p-2 mt-2">
        Register
      </button>
    </div>
  );
}
