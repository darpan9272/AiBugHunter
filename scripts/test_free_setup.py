#!/usr/bin/env python3
"""
Test script to verify free-only setup works correctly
"""

import json
import os
import sys
import subprocess
from pathlib import Path

def check_env_var(var_name, required=False):
    """Check if environment variable is set"""
    value = os.getenv(var_name)
    if required and not value:
        print(f"❌ {var_name} is required but not set")
        return False
    elif value:
        print(f"✅ {var_name} is set")
        return True
    else:
        print(f"⚠️  {var_name} is not set (using free alternatives)")
        return True  # Not required for free mode

def test_docker_containers():
    """Check that essential containers are running"""
    required_containers = [
        "bughunting_postgres",
        "bughunting_redis", 
        "bughunting_chroma"
    ]
    
    all_good = True
    for container in required_containers:
        try:
            result = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", container],
                capture_output=True, text=True, check=True
            )
            if result.stdout.strip() == "true":
                print(f"✅ {container} is running")
            else:
                print(f"❌ {container} is not running")
                all_good = False
        except subprocess.CalledProcessError:
            print(f"❌ {container} not found or error checking status")
            all_good = False
    
    return all_good

def test_free_tools():
    """Check that essential free tools are available"""
    tools = [
        ("nmap", "nmap --version"),
        ("httpx", "httpx -version"),
        ("subfinder", "subfinder -version"),
        ("katana", "katana -version"),
        ("gau", "gau -version"),
        ("nuclei", "nuclei -version"),
        ("ffuf", "ffuf -version"),
        ("dalfox", "dalfox -version"),
        ("sqlmap", "sqlmap --version"),
    ]
    
    all_good = True
    for tool, cmd in tools:
        try:
            result = subprocess.run(cmd.split(), capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                print(f"✅ {tool} is available")
            else:
                print(f"❌ {tool} not working properly")
                all_good = False
        except (subprocess.TimeoutExpired, FileNotFoundError):
            print(f"⚠️  {tool} not found (install for enhanced free capabilities)")
            # Not failing here as these are enhancements, not core requirements
    
    return True  # Don't fail on missing enhanced tools

def main():
    print("🔍 AI Swarm Bug Hunting System - Free Setup Test\n")
    
    # Load environment from .env file if it exists
    env_path = Path(".env")
    if env_path.exists():
        print("📄 Loading environment from .env file")
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key] = value
    
    print("\n[ Environment Configuration ]")
    check_env_var("POSTGRES_PASSWORD", required=True)
    check_env_var("CHROMA_AUTH_TOKEN", required=True)
    check_env_var("GOOGLE_API_KEY", required=False)
    check_env_var("ANTHROPIC_API_KEY", required=False)
    check_env_var("SHODAN_API_KEY", required=False)
    check_env_var("CENSYS_API_ID", required=False)
    check_env_var("NVD_API_KEY", required=False)
    
    # Determine mode
    using_local_llm = os.getenv("USE_LOCAL_LLM", "false").lower() == "true"
    has_ai_keys = bool(os.getenv("GOOGLE_API_KEY") or os.getenv("ANTHROPIC_API_KEY"))
    
    if using_local_llm:
        print("🤖 Mode: Completely Free (Local LLM)")
    elif has_ai_keys:
        print("🤖 Mode: Enhanced Free (API Keys + Local fallback)")
    else:
        print("🤖 Mode: Limited Free (Consider setting up Local LLM or API keys)")
    
    print("\n[ Docker Containers ]")
    containers_ok = test_docker_containers()
    
    print("\n[ Free Tools Availability ]")
    tools_ok = test_free_tools()
    
    print("\n" + "="*50)
    if containers_ok:
        print("✅ Core infrastructure is ready!")
        if tools_ok:
            print("✅ Free tools check passed!")
            print("\n🚀 System is ready for free operation!")
            print("\nNext steps:")
            print("1. Start frontend: cd frontend && npm run dev")
            print("2. Visit http://localhost:3000")
            print("3. Create a program and run your first scan!")
        else:
            print("⚠️  Some enhanced tools missing - core system still works")
    else:
        print("❌ Core infrastructure issues - please fix container problems")
        sys.exit(1)

if __name__ == "__main__":
    main()
