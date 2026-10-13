export function apiSpecification(){return {
  "openapi": "3.1.0",
  "info": {
    "title": "NEA Billing Public API",
    "version": "1.0.0",
    "description": "Independent, authenticated, read-only adapter to NEA billing HTML. Amounts are NPR. Missing units remain null. Rate limit: 30 NEA-bound requests per minute per client IP per Cloudflare location; an approximate protective limit, not a global quota. Shared-IP clients share capacity. No account statement storage."
  },
  "servers": [
    {
      "url": "/",
      "description": "The Cloudflare origin serving this specification"
    }
  ],
  "security": [{"bearerAuth": []}],
  "paths": {
    "/api/v1/branches": {
      "get": {
        "operationId": "listBranches",
        "summary": "List current NEA branches",
        "responses": {
          "200": {
            "description": "Branch directory",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "branches": {
                      "type": "array",
                      "items": {
                        "$ref": "#/components/schemas/Branch"
                      }
                    },
                    "source": {
                      "type": "string"
                    },
                    "apiVersion": {
                      "type": "string"
                    },
                    "requestId": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          },
          "429": {
            "description": "Rate limit; wait 60 seconds",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            },
            "headers": {
              "Retry-After": {
                "schema": {
                  "type": "integer",
                  "example": 60
                },
                "description": "Seconds to wait before retrying."
              }
            }
          },
          "502": {
            "description": "NEA lookup failed or statement could not be verified",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Request limiter unavailable",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/readings": {
      "post": {
        "operationId": "fetchStatement",
        "summary": "Fetch an authorized account statement",
        "description": "Dates are Gregorian ISO; maximum range approximately three years. Consumed units are billed monthly usage, not cumulative meter readings. Use recorded VAT/payables instead of recomputing tax. Identifiers shown in examples are placeholders.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LookupRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Verified live NEA statement",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Statement"
                }
              }
            }
          },
          "400": {
            "description": "Invalid input",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Body exceeds 4096 bytes",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "JSON Content-Type required",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate limit; wait 60 seconds",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            },
            "headers": {
              "Retry-After": {
                "schema": {
                  "type": "integer",
                  "example": 60
                },
                "description": "Seconds to wait before retrying."
              }
            }
          },
          "502": {
            "description": "NEA lookup failed or statement could not be verified",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Request limiter unavailable",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/health": {
      "get": {
        "operationId": "health",
        "security": [],
        "summary": "Check API runtime availability; does not contact NEA",
        "responses": {
          "200": {
            "description": "API available",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "status": {
                      "type": "string",
                      "const": "ok"
                    },
                    "apiVersion": {
                      "type": "string"
                    },
                    "requestId": {
                      "type": "string"
                    },
                    "upstream": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/v1/openapi.json": {
      "get": {
        "security": [],
        "operationId": "openApi",
        "summary": "Download this OpenAPI specification",
        "responses": {
          "200": {
            "description": "OpenAPI 3.1 specification",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object"
                }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}},
    "schemas": {
      "LookupRequest": {
        "type": "object",
        "properties": {
          "consumerId": {
            "type": "string",
            "pattern": "^[0-9]{1,20}$",
            "example": "12345"
          },
          "scNo": {
            "type": "string",
            "minLength": 3,
            "maxLength": 40,
            "example": "001.19.001",
            "description": "SC number including separators; not physical meter serial."
          },
          "branch": {
            "type": "string",
            "pattern": "^[0-9]{1,6}$",
            "example": "241"
          },
          "from": {
            "type": "string",
            "format": "date",
            "example": "2026-03-01"
          },
          "to": {
            "type": "string",
            "format": "date",
            "example": "2026-10-13"
          }
        },
        "required": [
          "consumerId",
          "scNo",
          "branch",
          "from",
          "to"
        ]
      },
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "code": {
            "type": "string"
          },
          "requestId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "error",
          "code",
          "requestId"
        ]
      },
      "Branch": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "label": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name",
          "label"
        ]
      },
      "Totals": {
        "type": "object",
        "properties": {
          "billAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "payableAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "paidAmount": {
            "type": [
              "number",
              "null"
            ]
          }
        }
      },
      "Record": {
        "type": "object",
        "properties": {
          "consumedUnits": {
            "type": [
              "number",
              "null"
            ]
          },
          "billAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "rate": {
            "type": [
              "number",
              "null"
            ]
          },
          "payableAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "paidAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "period": {
            "type": [
              "string",
              "null"
            ]
          },
          "billDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "adjustment": {
            "type": [
              "string",
              "null"
            ]
          },
          "merchant": {
            "type": [
              "string",
              "null"
            ]
          },
          "transactionId": {
            "type": [
              "string",
              "null"
            ]
          },
          "paidDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "sequence": {
            "type": "integer"
          },
          "kind": {
            "type": "string",
            "enum": [
              "bill",
              "payment",
              "balance"
            ]
          },
          "category": {
            "type": "string",
            "enum": [
              "monthly",
              "vat",
              "arrears",
              "receipt",
              "other",
              "advance",
              "balance"
            ]
          },
          "status": {
            "type": "string"
          },
          "statementGroup": {
            "type": "integer",
            "description": "Section containing this original row; use with sequence to identify rows within a snapshot."
          }
        }
      },
      "Month": {
        "type": "object",
        "properties": {
          "consumedUnits": {
            "type": [
              "number",
              "null"
            ]
          },
          "baseAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "adjustmentRate": {
            "type": [
              "number",
              "null"
            ]
          },
          "adjustmentAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "adjustedBaseAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "vatAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "vatPayable": {
            "type": [
              "number",
              "null"
            ]
          },
          "otherCharges": {
            "type": [
              "number",
              "null"
            ]
          },
          "totalPayable": {
            "type": [
              "number",
              "null"
            ]
          },
          "paidAmount": {
            "type": [
              "number",
              "null"
            ]
          },
          "paymentDifference": {
            "type": [
              "number",
              "null"
            ]
          },
          "period": {
            "type": [
              "string",
              "null"
            ]
          },
          "billDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "billDateISO": {
            "type": [
              "string",
              "null"
            ]
          },
          "adjustment": {
            "type": [
              "string",
              "null"
            ]
          },
          "transactionId": {
            "type": [
              "string",
              "null"
            ]
          },
          "paidDate": {
            "type": [
              "string",
              "null"
            ]
          },
          "association": {
            "type": [
              "string",
              "null"
            ]
          },
          "sequence": {
            "type": "integer"
          },
          "vatPresent": {
            "type": "boolean"
          },
          "status": {
            "type": "string"
          },
          "sourceSequences": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "receiptSequence": {
            "type": [
              "integer",
              "null"
            ]
          },
          "statementGroup": {
            "type": [
              "integer",
              "null"
            ]
          }
        }
      },
      "Consumption": {
        "type": "object",
        "properties": {
          "totalReportedUnits": {
            "type": [
              "number",
              "null"
            ]
          },
          "reportedMonthlyBills": {
            "type": "integer"
          },
          "missingMonthlyBills": {
            "type": "integer"
          },
          "firstReportedPeriod": {
            "type": [
              "string",
              "null"
            ]
          },
          "lastReportedPeriod": {
            "type": [
              "string",
              "null"
            ]
          },
          "complete": {
            "type": "boolean"
          }
        }
      },
      "Statement": {
        "type": "object",
        "properties": {
          "apiVersion": {
            "type": "string",
            "const": "1"
          },
          "requestId": {
            "type": "string",
            "format": "uuid"
          },
          "account": {
            "type": "object",
            "properties": {
              "name": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "location": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "consumerId": {
                "type": "string"
              },
              "scNo": {
                "type": "string"
              },
              "branchId": {
                "type": "string"
              }
            }
          },
          "records": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Record"
            }
          },
          "summary": {
            "type": "object",
            "properties": {
              "months": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/Month"
                }
              },
              "consumption": {
                "$ref": "#/components/schemas/Consumption"
              },
              "totals": {
                "$ref": "#/components/schemas/Totals"
              },
              "sourceTotals": {
                "anyOf": [
                  {
                    "$ref": "#/components/schemas/Totals"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Aggregated reported controls for separate billing sections; null if no separate billing controls are supplied. Original section controls remain in statementGroups."
              },
              "paidDifference": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "sourceTotalMismatches": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "unallocatedCharges": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/Record"
                }
              },
              "scheduledReadingDay": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "statementGroups": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/StatementGroup"
                }
              },
              "balanceRecords": {
                "type": "array",
                "items": {
                  "$ref": "#/components/schemas/Record"
                }
              }
            }
          },
          "source": {
            "type": "string",
            "format": "uri"
          },
          "fetchedAt": {
            "type": "string",
            "format": "date-time"
          },
          "range": {
            "type": "object",
            "properties": {
              "from": {
                "type": "string",
                "format": "date"
              },
              "to": {
                "type": "string",
                "format": "date"
              }
            }
          },
          "readingAvailability": {
            "type": "object",
            "properties": {
              "previousReading": {
                "type": "boolean",
                "const": false
              },
              "currentReading": {
                "type": "boolean",
                "const": false
              },
              "consumedUnits": {
                "type": "boolean"
              }
            }
          },
          "note": {
            "type": "string"
          }
        }
      },
      "StatementGroup": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "status": {
            "type": [
              "string",
              "null"
            ]
          },
          "billing": {
            "type": "boolean"
          },
          "recordSequences": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "sourceTotals": {
            "anyOf": [
              {
                "$ref": "#/components/schemas/Totals"
              },
              {
                "type": "null"
              }
            ]
          },
          "computedTotals": {
            "$ref": "#/components/schemas/Totals"
          },
          "mismatches": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    }
  }
};}
