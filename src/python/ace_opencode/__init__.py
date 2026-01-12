"""
ACE OpenCode Integration

Context-aware extensions for the Agentic Context Engine (ACE) Python package.
This module provides OpenCode-specific features on top of the base ACE package.
"""

from .skillbook_manager import SkillbookManager
from .learn import learn_from_reflection

__all__ = ["SkillbookManager", "learn_from_reflection"]
__version__ = "0.1.0"
