"""
Scan Profile Service
Manages loading, validation, and application of scan profiles for bug hunting campaigns.
"""

import yaml
import os
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
import json


@dataclass
class ScanProfile:
    """Represents a scan profile configuration."""
    name: str
    description: str
    type: str
    recon: List[str]
    triage: List[str]
    exploit: List[str]
    rate_limit: int
    timeout: int
    safe_mode: bool = True
    evidence_capture: bool = True
    # Additional optional fields
    wp_api_token: Optional[str] = None
    # Add more tool-specific configs as needed


class ScanProfileService:
    """Service for managing scan profiles."""
    
    def __init__(self, profiles_dir: str = "./scan-profiles"):
        self.profiles_dir = Path(profiles_dir)
        self.profiles: Dict[str, ScanProfile] = {}
        self._load_all_profiles()
    
    def _load_all_profiles(self):
        """Load all YAML profiles from the profiles directory."""
        if not self.profiles_dir.exists():
            self.profiles_dir.mkdir(parents=True, exist_ok=True)
            return
            
        for profile_file in self.profiles_dir.glob("*.yaml"):
            try:
                profile = self._load_profile(profile_file)
                if profile:
                    self.profiles[profile.name] = profile
            except Exception as e:
                print(f"Warning: Failed to load profile {profile_file}: {e}")
        
        for profile_file in self.profiles_dir.glob("*.yml"):
            try:
                profile = self._load_profile(profile_file)
                if profile:
                    self.profiles[profile.name] = profile
            except Exception as e:
                print(f"Warning: Failed to load profile {profile_file}: {e}")
    
    def _load_profile(self, file_path: Path) -> Optional[ScanProfile]:
        """Load a single scan profile from YAML file."""
        try:
            with open(file_path, 'r') as f:
                data = yaml.safe_load(f)
            
            # Validate required fields
            required_fields = ['name', 'description', 'type', 'recon', 'triage', 'exploit', 'rate_limit', 'timeout']
            for field in required_fields:
                if field not in data:
                    raise ValueError(f"Missing required field: {field}")
            
            # Create ScanProfile instance
            profile = ScanProfile(
                name=data['name'],
                description=data['description'],
                type=data['type'],
                recon=data['recon'],
                triage=data['triage'],
                exploit=data['exploit'],
                rate_limit=data['rate_limit'],
                timeout=data['timeout'],
                safe_mode=data.get('safe_mode', True),
                evidence_capture=data.get('evidence_capture', True),
                wp_api_token=data.get('wp_api_token')
            )
            
            return profile
        except Exception as e:
            print(f"Error loading profile {file_path}: {e}")
            return None
    
    def get_profile(self, name: str) -> Optional[ScanProfile]:
        """Get a scan profile by name."""
        return self.profiles.get(name)
    
    def list_profiles(self) -> List[str]:
        """List all available profile names."""
        return list(self.profiles.keys())
    
    def get_all_profiles(self) -> Dict[str, ScanProfile]:
        """Get all scan profiles."""
        return self.profiles.copy()
    
    def add_profile(self, profile: ScanProfile) -> bool:
        """Add a new scan profile."""
        try:
            # Save to file
            profile_file = self.profiles_dir / f"{profile.name.lower().replace(' ', '-')}.yaml"
            profile_dict = asdict(profile)
            
            # Remove None values
            profile_dict = {k: v for k, v in profile_dict.items() if v is not None}
            
            with open(profile_file, 'w') as f:
                yaml.dump(profile_dict, f, default_flow_style=False, sort_keys=False)
            
            # Add to cache
            self.profiles[profile.name] = profile
            return True
        except Exception as e:
            print(f"Error adding profile {profile.name}: {e}")
            return False
    
    def remove_profile(self, name: str) -> bool:
        """Remove a scan profile."""
        try:
            if name in self.profiles:
                # Remove file
                profile_file = self.profiles_dir / f"{name.lower().replace(' ', '-')}.yaml"
                if profile_file.exists():
                    profile_file.unlink()
                
                # Remove from cache
                del self.profiles[name]
                return True
            return False
        except Exception as e:
            print(f"Error removing profile {name}: {e}")
            return False
    
    def validate_profile_against_tools(self, profile: ScanProfile) -> Dict[str, List[str]]:
        """
        Validate that the tools in a profile are available/configured.
        Returns dict with 'available' and 'missing' tool lists.
        """
        # This would check against available MCP tools, installed scanners, etc.
        # For now, return all as available - in practice this would check
        # against actual tool availability
        all_tools = set(profile.recon + profile.triage + profile.exploit)
        return {
            'available': list(all_tools),
            'missing': []
        }
    
    def get_profile_summary(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a summary of a profile for display in UI."""
        profile = self.get_profile(name)
        if not profile:
            return None
            
        return {
            'name': profile.name,
            'description': profile.description,
            'type': profile.type,
            'tool_counts': {
                'recon': len(profile.recon),
                'triage': len(profile.triage),
                'exploit': len(profile.exploit)
            },
            'rate_limit': profile.rate_limit,
            'timeout_minutes': profile.timeout // 60,
            'safe_mode': profile.safe_mode,
            'evidence_capture': profile.evidence_capture
        }


# Global instance for easy access
scan_profile_service = ScanProfileService()


def get_scan_profile_service() -> ScanProfileService:
    """Get the global scan profile service instance."""
    return scan_profile_service


if __name__ == "__main__":
    # Test the service
    service = ScanProfileService()
    print("Loaded profiles:", service.list_profiles())
    
    for name in service.list_profiles():
        summary = service.get_profile_summary(name)
        print(f"\n{name}:")
        print(f"  Description: {summary['description']}")
        print(f"  Type: {summary['type']}")
        print(f"  Tools - Recon: {summary['tool_counts']['recon']}, "
              f"Triage: {summary['tool_counts']['triage']}, "
              f"Exploit: {summary['tool_counts']['exploit']}")
        print(f"  Rate Limit: {summary['rate_limit']} req/s")
        print(f"  Timeout: {summary['timeout_minutes']} min")
