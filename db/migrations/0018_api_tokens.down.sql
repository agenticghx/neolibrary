-- Going back removes every API token. They are credentials, so losing them
-- is the safe outcome: agents stop working until new tokens are made.
DROP TABLE api_tokens;
