#!/usr/bin/env python3
"""
OpenCode LLM Adapter for ACE Framework.

This module provides an ACE-compatible LLM client that uses OpenCode SDK
instead of LiteLLM/direct API calls. This allows ACE to use whatever
LLM providers are configured in the user's OpenCode instance.
"""

import json
import logging
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Any, Dict, Optional

from ace.llm import LLMClient, LLMResponse

logger = logging.getLogger(__name__)


@dataclass
class OpenCodeConfig:
    """Configuration for OpenCode LLM client."""

    base_url: str = "http://localhost:4096"
    provider_id: str = "github-copilot"
    model_id: str = "gpt-4o"
    temperature: float = 0.0
    max_tokens: int = 2048
    timeout: int = 120


class OpenCodeLLMClient(LLMClient):
    """
    ACE-compatible LLM client that uses OpenCode SDK.

    Instead of calling OpenAI/Anthropic directly, this calls the OpenCode
    server which proxies to user's configured providers. This means:

    - No API keys needed in the plugin
    - Uses whatever providers user has configured in OpenCode
    - Works with GitHub Copilot, local models, etc.

    The client implements ACE's LLMClient interface so it can be used
    as a drop-in replacement for LiteLLMClient in Reflector and SkillManager.

    Example:
        >>> client = OpenCodeLLMClient()
        >>> response = client.complete("What is 2+2?")
        >>> print(response.text)
        "4"
    """

    def __init__(
        self,
        base_url: str = "http://localhost:4096",
        provider_id: Optional[str] = None,
        model_id: Optional[str] = None,
        temperature: float = 0.0,
        max_tokens: int = 2048,
        timeout: int = 120,
        config: Optional[OpenCodeConfig] = None,
        **kwargs: Any,
    ) -> None:
        if config:
            self.config = config
        else:
            self.config = OpenCodeConfig(
                base_url=base_url,
                provider_id=provider_id or "github-copilot",
                model_id=model_id or "gpt-4o",
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
            )

        super().__init__(model=f"{self.config.provider_id}/{self.config.model_id}")

        self._session_id: Optional[str] = None

    def _create_session(self) -> str:
        """Create a new OpenCode session for LLM calls."""
        url = f"{self.config.base_url}/session"

        data = json.dumps({"title": "ACE Learning Session"}).encode("utf-8")

        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("id") or result.get("data", {}).get("id")
        except urllib.error.URLError as e:
            logger.error(f"Failed to create OpenCode session: {e}")
            raise ConnectionError(
                f"Cannot connect to OpenCode server at {self.config.base_url}: {e}"
            )

    def _delete_session(self, session_id: str) -> None:
        """Delete an OpenCode session."""
        url = f"{self.config.base_url}/session/{session_id}"

        req = urllib.request.Request(url, method="DELETE")

        try:
            with urllib.request.urlopen(req, timeout=10):
                pass
        except Exception:
            pass

    def _prompt_session(
        self, session_id: str, prompt: str, system: Optional[str] = None
    ) -> str:
        """Send a prompt to an OpenCode session and get response."""
        url = f"{self.config.base_url}/session/{session_id}/prompt"

        parts = []
        if system:
            parts.append({"type": "text", "text": f"[System]: {system}\n\n"})
        parts.append({"type": "text", "text": prompt})

        data = json.dumps(
            {
                "model": {
                    "providerID": self.config.provider_id,
                    "modelID": self.config.model_id,
                },
                "parts": parts,
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            url, data=data, headers={"Content-Type": "application/json"}, method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout) as response:
                result = json.loads(response.read().decode("utf-8"))

                if "data" in result and "parts" in result["data"]:
                    parts = result["data"]["parts"]
                    for part in parts:
                        if part.get("type") == "text":
                            return part.get("text", "")

                if "choices" in result:
                    return result["choices"][0].get("message", {}).get("content", "")

                return str(result)

        except urllib.error.URLError as e:
            logger.error(f"Failed to prompt OpenCode session: {e}")
            raise ConnectionError(f"OpenCode prompt failed: {e}")

    def complete(
        self, prompt: str, system: Optional[str] = None, **kwargs: Any
    ) -> LLMResponse:
        """
        Generate completion for the given prompt using OpenCode SDK.

        This is the main method that ACE calls. We create a session,
        send the prompt, get the response, and clean up.

        Args:
            prompt: Input prompt text
            system: Optional system message
            **kwargs: Additional parameters (mostly ignored, for compatibility)

        Returns:
            LLMResponse containing the generated text
        """
        session_id = None

        try:
            session_id = self._create_session()

            text = self._prompt_session(session_id, prompt, system)

            metadata = {
                "model": self.model,
                "provider": self.config.provider_id,
                "session_id": session_id,
            }

            return LLMResponse(text=text, raw=metadata)

        except Exception as e:
            logger.error(f"OpenCode LLM completion failed: {e}")
            raise

        finally:
            if session_id:
                self._delete_session(session_id)

    def complete_structured(
        self, prompt: str, response_model: Any, **kwargs: Any
    ) -> Any:
        """
        Generate structured output (JSON) and parse with Pydantic model.

        ACE's Reflector and SkillManager may call this for structured responses.
        We add JSON formatting instructions and parse the result.

        Args:
            prompt: Input prompt text
            response_model: Pydantic model class to validate response
            **kwargs: Additional parameters

        Returns:
            Instance of response_model populated with LLM response
        """
        json_prompt = f"""{prompt}

IMPORTANT: Respond with a valid JSON object only. No explanation, no markdown, just JSON.
The response must be parseable by json.loads()."""

        response = self.complete(json_prompt, **kwargs)

        text = response.text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            text = text[start:end]

        try:
            data = json.loads(text)
            return response_model.model_validate(data)
        except json.JSONDecodeError as e:
            logger.error(
                f"Failed to parse JSON from LLM response: {e}\nResponse: {text[:500]}"
            )
            raise ValueError(f"LLM returned invalid JSON: {e}")

    @classmethod
    def is_available(cls, base_url: str = "http://localhost:4096") -> bool:
        """Check if OpenCode server is available."""
        try:
            req = urllib.request.Request(f"{base_url}/health", method="GET")
            with urllib.request.urlopen(req, timeout=5):
                return True
        except Exception:
            return False
