// Copyright Epic Games, Inc. All Rights Reserved.
// Modified by unreal-rc codegen: custom cycle-safe JSON exporter for UHT reflection data.
// Replaces Epic's default serializer (which has object cycle bugs) with manual Utf8JsonWriter.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using EpicGames.UHT.Tables;
using EpicGames.UHT.Types;
using EpicGames.UHT.Utils;

namespace EpicGames.UHT.Exporters.Json
{
	[UnrealHeaderTool]
	class UhtJsonExporter
	{

		[UhtExporter(Name = "Json", Description = "Json description of packages", Options = UhtExporterOptions.None)]
		public static void JsonExporter(IUhtExportFactory factory)
		{
			new UhtJsonExporter(factory).Export();
		}

		public readonly IUhtExportFactory Factory;
		public UhtSession Session => Factory.Session;

		private UhtJsonExporter(IUhtExportFactory factory)
		{
			Factory = factory;
		}

		private void Export()
		{
			List<Task?> generatedPackages = new(Session.PackageTypeCount);
			foreach (UhtModule module in Session.Modules)
			{
				generatedPackages.Add(Factory.CreateTask(
					(IUhtExportFactory factory) =>
					{
						string jsonPath = factory.MakePath(module, ".json");
						using MemoryStream stream = new();
						using Utf8JsonWriter writer = new(stream, new JsonWriterOptions { Indented = true });
						WriteModule(writer, module);
						writer.Flush();
						factory.CommitOutput(jsonPath, System.Text.Encoding.UTF8.GetString(stream.ToArray()));
					}));
			}

			List<Task> packageTasks = new(Session.PackageTypeCount);
			foreach (Task? output in generatedPackages)
			{
				if (output != null)
				{
					packageTasks.Add(output);
				}
			}
			Task.WaitAll(packageTasks.ToArray());
		}

		private static void WriteModule(Utf8JsonWriter w, UhtModule module)
		{
			w.WriteStartObject();
			w.WriteString("ShortName", module.ShortName);
			w.WritePropertyName("Packages");
			w.WriteStartArray();
			foreach (UhtPackage package in module.Packages)
			{
				WritePackage(w, package);
			}
			w.WriteEndArray();
			w.WriteEndObject();
		}

		private static void WritePackage(Utf8JsonWriter w, UhtPackage package)
		{
			w.WriteStartObject();
			w.WriteString("SourceName", package.SourceName);
			w.WritePropertyName("Children");
			w.WriteStartArray();
			foreach (UhtType child in package.Children)
			{
				WriteType(w, child);
			}
			w.WriteEndArray();
			w.WriteEndObject();
		}

		private static void WriteType(Utf8JsonWriter w, UhtType type)
		{
			switch (type)
			{
				case UhtClass cls:
					WriteClass(w, cls);
					break;
				case UhtScriptStruct scriptStruct:
					WriteStruct(w, scriptStruct);
					break;
				case UhtEnum enumType:
					WriteEnum(w, enumType);
					break;
				case UhtFunction func:
					WriteFunction(w, func);
					break;
				case UhtProperty prop:
					WriteProperty(w, prop);
					break;
				default:
					// Skip unknown types
					break;
			}
		}

		private static void WriteClass(Utf8JsonWriter w, UhtClass cls)
		{
			w.WriteStartObject();
			w.WriteString("Kind", "Class");
			w.WriteString("SourceName", cls.SourceName);
			w.WriteString("EngineName", cls.EngineName);
			w.WriteString("EngineClassName", cls.EngineClassName);
			w.WriteString("ClassFlags", cls.ClassFlags.ToString());
			w.WriteString("ClassType", cls.ClassType.ToString());
			if (cls.Super != null)
			{
				w.WriteString("Super", cls.Super.SourceName);
			}
			WriteMetaData(w, cls.MetaData);

			// Functions
			w.WritePropertyName("Functions");
			w.WriteStartArray();
			foreach (UhtType child in cls.Children)
			{
				if (child is UhtFunction func)
				{
					WriteFunction(w, func);
				}
			}
			w.WriteEndArray();

			// Properties
			w.WritePropertyName("Properties");
			w.WriteStartArray();
			foreach (UhtType child in cls.Children)
			{
				if (child is UhtProperty prop)
				{
					WriteProperty(w, prop);
				}
			}
			w.WriteEndArray();

			w.WriteEndObject();
		}

		private static void WriteStruct(Utf8JsonWriter w, UhtScriptStruct scriptStruct)
		{
			w.WriteStartObject();
			w.WriteString("Kind", "Struct");
			w.WriteString("SourceName", scriptStruct.SourceName);
			w.WriteString("EngineName", scriptStruct.EngineName);
			w.WriteString("EngineClassName", scriptStruct.EngineClassName);
			if (scriptStruct.Super != null)
			{
				w.WriteString("Super", scriptStruct.Super.SourceName);
			}
			WriteMetaData(w, scriptStruct.MetaData);

			w.WritePropertyName("Properties");
			w.WriteStartArray();
			foreach (UhtType child in scriptStruct.Children)
			{
				if (child is UhtProperty prop)
				{
					WriteProperty(w, prop);
				}
			}
			w.WriteEndArray();

			w.WriteEndObject();
		}

		private static void WriteEnum(Utf8JsonWriter w, UhtEnum enumType)
		{
			w.WriteStartObject();
			w.WriteString("Kind", "Enum");
			w.WriteString("SourceName", enumType.SourceName);
			w.WriteString("EngineName", enumType.EngineName);
			w.WriteString("CppForm", enumType.CppForm.ToString());
			w.WriteString("UnderlyingType", enumType.UnderlyingType.ToString());
			WriteMetaData(w, enumType.MetaData);

			w.WritePropertyName("Values");
			w.WriteStartArray();
			foreach (UhtEnumValue val in enumType.EnumValues)
			{
				w.WriteStartObject();
				w.WriteString("Name", val.Name);
				w.WriteNumber("Value", val.Value);
				w.WriteEndObject();
			}
			w.WriteEndArray();

			w.WriteEndObject();
		}

		private static void WriteFunction(Utf8JsonWriter w, UhtFunction func)
		{
			w.WriteStartObject();
			w.WriteString("Kind", "Function");
			w.WriteString("SourceName", func.SourceName);
			w.WriteString("EngineName", func.EngineName);
			w.WriteString("FunctionFlags", func.FunctionFlags.ToString());
			w.WriteString("FunctionExportFlags", func.FunctionExportFlags.ToString());
			w.WriteString("FunctionType", func.FunctionType.ToString());
			WriteMetaData(w, func.MetaData);

			w.WritePropertyName("Parameters");
			w.WriteStartArray();
			foreach (UhtType child in func.Children)
			{
				if (child is UhtProperty prop)
				{
					WriteProperty(w, prop);
				}
			}
			w.WriteEndArray();

			w.WriteEndObject();
		}

		private static void WriteProperty(Utf8JsonWriter w, UhtProperty prop)
		{
			w.WriteStartObject();
			w.WriteString("Kind", "Property");
			w.WriteString("SourceName", prop.SourceName);
			w.WriteString("EngineName", prop.EngineName);
			w.WriteString("EngineClassName", prop.EngineClassName);
			w.WriteString("PropertyCategory", prop.PropertyCategory.ToString());
			w.WriteString("PropertyFlags", prop.PropertyFlags.ToString());
			w.WriteString("PropertyExportFlags", prop.PropertyExportFlags.ToString());
			WriteMetaData(w, prop.MetaData);

			// Write inner properties for containers (TArray, TMap, TSet)
			bool hasInnerChildren = false;
			foreach (UhtType child in prop.Children)
			{
				if (child is UhtProperty)
				{
					hasInnerChildren = true;
					break;
				}
			}
			if (hasInnerChildren)
			{
				w.WritePropertyName("Inner");
				w.WriteStartArray();
				foreach (UhtType child in prop.Children)
				{
					if (child is UhtProperty innerProp)
					{
						WriteProperty(w, innerProp);
					}
				}
				w.WriteEndArray();
			}

			w.WriteEndObject();
		}

		private static void WriteMetaData(Utf8JsonWriter w, UhtMetaData metaData)
		{
			bool hasEntries = false;
			foreach (KeyValuePair<string, string> kvp in metaData.GetSorted())
			{
				if (!hasEntries)
				{
					w.WritePropertyName("MetaData");
					w.WriteStartObject();
					hasEntries = true;
				}
				w.WriteString(kvp.Key, kvp.Value);
			}
			if (hasEntries)
			{
				w.WriteEndObject();
			}
		}
	}
}
