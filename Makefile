.PHONY: setup smoke api web agent

setup:
	conda env create -f environment.yml || conda env update -f environment.yml
	cd web && npm install

smoke:
	python scripts/smoke_test.py

api:
	uvicorn api.main:app --reload --port 8000

web:
	cd web && npm run dev

agent:
	python -m agent.agent "hello"
